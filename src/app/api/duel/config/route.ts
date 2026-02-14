import { NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const secret = process.env.TREASURY_SECRET_KEY;
    if (!secret) return NextResponse.json({ error: "MISSING_TREASURY_SECRET_KEY" }, { status: 500 });

    const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
    return NextResponse.json({ treasuryPubkey: treasury.publicKey.toBase58() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
