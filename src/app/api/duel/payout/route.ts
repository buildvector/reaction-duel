// src/app/api/duel/payout/route.ts
import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getDuel, markPayout, netStakeFor } from "@/lib/duelStore";

export const runtime = "nodejs";

/* ---------------- Upstash lock (prevents double payout) ---------------- */

type RedisEnv = { url: string; token: string };

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
}

function redisEnv(): RedisEnv {
  return {
    url: mustEnv("UPSTASH_REDIS_REST_URL"),
    token: mustEnv("UPSTASH_REDIS_REST_TOKEN"),
  };
}

async function redis<T>(command: string, ...args: any[]): Promise<T> {
  const { url, token } = redisEnv();
  const path = `${url}/${command}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`;

  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `REDIS_${command}_FAILED`);
  return json?.result as T;
}

function lockKey(duelId: string) {
  return `duel:payout_lock:${duelId.toUpperCase()}`;
}

/* ---------------- Route ---------------- */

export async function POST(req: Request) {
  let lockAcquired = false;
  let duelId = "";

  try {
    const body = await req.json().catch(() => ({}));
    duelId = String(body?.duelId ?? "").trim().toUpperCase();
    if (!duelId) return NextResponse.json({ error: "DUEL_ID_REQUIRED" }, { status: 400 });

    // 1) Acquire short lock (60s) so only one payout can run at a time
    // Redis: SET key value NX PX 60000
    const lockRes = await redis<string | null>("set", lockKey(duelId), "1", "NX", "PX", 60_000);
    if (lockRes !== "OK") {
      // Someone else is paying right now. Return current duel state (idempotent UX).
      const existing = await getDuel(duelId);
      return NextResponse.json({ duel: existing, locked: true });
    }
    lockAcquired = true;

    // 2) Re-fetch duel AFTER lock (important)
    const duel = await getDuel(duelId);
    if (!duel) return NextResponse.json({ error: "DUEL_NOT_FOUND" }, { status: 404 });

    if (duel.phase !== "finished") return NextResponse.json({ error: "DUEL_NOT_FINISHED" }, { status: 400 });
    if (!duel.winner) return NextResponse.json({ error: "NO_WINNER" }, { status: 400 });

    // 3) Idempotent: if already paid out, just return duel
    if (duel.payoutSig) return NextResponse.json({ duel });

    // 4) Execute payout
    const rpc = mustEnv("SOLANA_RPC_URL");
    const secret = mustEnv("TREASURY_SECRET_KEY");
    const connection = new Connection(rpc, "confirmed");

    const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));

    const winnerPubkey =
      duel.winner === "A" ? new PublicKey(duel.createdBy) : new PublicKey(duel.joinedBy!);

    const net = netStakeFor(duel.stakeLamports, duel.feeBps);
    const pot = net * 2;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: winnerPubkey,
        lamports: pot,
      })
    );

    // recent blockhash helps reliability
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = treasury.publicKey;

    tx.sign(treasury);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    // 5) Persist payoutSig (this is what makes payout fully idempotent)
    const updated = await markPayout({ duelId, payoutSig: sig });

    return NextResponse.json({ duel: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  } finally {
    // Optional: you can delete the lock immediately.
    // But keeping the TTL is also fine. Deleting makes retries faster if something failed after locking.
    if (lockAcquired && duelId) {
      try {
        await redis("del", lockKey(duelId));
      } catch {}
    }
  }
}
