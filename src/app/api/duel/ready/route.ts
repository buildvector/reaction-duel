import { NextResponse } from "next/server";
import { setReady } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const duelId = String(body?.duelId ?? "").trim().toUpperCase();
    const pubkey = String(body?.pubkey ?? "").trim();

    if (!duelId || !pubkey) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }

    const duel = await setReady({ duelId, pubkey });
    return NextResponse.json({ duel, serverNow: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
