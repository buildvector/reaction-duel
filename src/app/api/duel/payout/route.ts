// src/app/api/duel/payout/route.ts
import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
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

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? `REDIS_${command}_FAILED`);
  return (json as any)?.result as T;
}

function lockKey(duelId: string) {
  return `duel:payout_lock:${duelId.toUpperCase()}`;
}

function postOnceKey(duelId: string) {
  return `duel:solarena_posted:${duelId.toUpperCase()}`;
}

/* ---------------- SolArena leaderboard integration ---------------- */

const SOLARENA_MATCH_URL =
  process.env.SOLARENA_MATCH_URL?.trim() ||
  "https://sol-arena-web.vercel.app/api/match";

const SOLARENA_GAME_KEY = process.env.SOLARENA_GAME_KEY?.trim() || "";

type SolarenaResult = "win" | "play" | "loss";

async function postSolarenaEvent(params: {
  wallet: string;
  result: SolarenaResult;
  amountSol: number;
  duelId: string;
  role: "winner" | "loser";
  payoutSig?: string | null;
  metaExtra?: Record<string, any>;
}) {
  try {
    if (!params.wallet) return;

    if (!SOLARENA_GAME_KEY) {
      console.log("[reaction] SOLARENA_GAME_KEY missing -> skip leaderboard post");
      return;
    }

    if (!Number.isFinite(params.amountSol) || params.amountSol < 0) {
      console.log("[reaction] amountSol invalid -> skip leaderboard post", params.amountSol);
      return;
    }

    const res = await fetch(SOLARENA_MATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-game-key": SOLARENA_GAME_KEY,
      },
      body: JSON.stringify({
        wallet: params.wallet,
        game: "reaction", // 👈 keep this stable across the project
        result: params.result,
        amountSol: params.amountSol,
        meta: JSON.stringify({
          source: "reaction",
          duelId: params.duelId,
          role: params.role,
          payoutSig: params.payoutSig ?? null,
          ...(params.metaExtra ?? {}),
        }),
      }),
    });

    const txt = await res.text().catch(() => "");
    console.log("[reaction] postSolarenaEvent ->", res.status, txt.slice(0, 200));
  } catch (e: any) {
    console.log("[reaction] postSolarenaEvent failed ->", e?.message ?? e);
  }
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
      const existing = await getDuel(duelId);
      return NextResponse.json({ duel: existing, locked: true });
    }
    lockAcquired = true;

    // 2) Re-fetch duel AFTER lock
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

    const winnerWallet =
      duel.winner === "A" ? String(duel.createdBy) : String(duel.joinedBy ?? "");
    if (!winnerWallet) return NextResponse.json({ error: "WINNER_WALLET_MISSING" }, { status: 400 });

    const loserWallet =
      winnerWallet === String(duel.createdBy) ? String(duel.joinedBy ?? "") : String(duel.createdBy ?? "");
    // loserWallet can be empty in weird edge-cases, that's fine (we just won't post loser)

    const winnerPubkey = new PublicKey(winnerWallet);

    const net = netStakeFor(duel.stakeLamports, duel.feeBps);
    const potLamports = net * 2;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: winnerPubkey,
        lamports: potLamports,
      })
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = treasury.publicKey;
    tx.sign(treasury);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    // 5) Persist payoutSig (idempotency)
    const updated = await markPayout({ duelId, payoutSig: sig });

    // 6) Post leaderboard events ONCE per duel (dedupe)
    // Keep a long TTL so replays/retries never double-count.
    const postRes = await redis<string | null>("set", postOnceKey(duelId), "1", "NX", "PX", 7 * 24 * 60 * 60 * 1000);
    const shouldPost = postRes === "OK";

    if (shouldPost) {
      const potSol = potLamports / LAMPORTS_PER_SOL;
      const stakeSol = Number(duel.stakeLamports ?? 0) / LAMPORTS_PER_SOL;

      const metaExtra = {
        duelId,
        winnerSide: duel.winner,
        stakeLamports: duel.stakeLamports,
        feeBps: duel.feeBps,
        netLamports: net,
        potLamports,
      };

      // winner: win with payout volume
      await postSolarenaEvent({
        wallet: winnerWallet,
        result: "win",
        amountSol: potSol,
        duelId,
        role: "winner",
        payoutSig: sig,
        metaExtra,
      });

      // loser: play with stake volume (fair volume distribution)
      if (loserWallet) {
        await postSolarenaEvent({
          wallet: loserWallet,
          result: "play",
          amountSol: stakeSol,
          duelId,
          role: "loser",
          payoutSig: sig,
          metaExtra,
        });
      }
    } else {
      console.log("[reaction] already posted -> skip", duelId);
    }

    return NextResponse.json({ duel: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  } finally {
    // Optional delete lock immediately (TTL is also fine)
    if (lockAcquired && duelId) {
      try {
        await redis("del", lockKey(duelId));
      } catch {}
    }
  }
}