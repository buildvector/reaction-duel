import { NextResponse } from "next/server";
import { getDuel, joinDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const duelId = String(body?.duelId ?? "").trim().toUpperCase();
    const joinedBy = String(body?.joinedBy ?? "").trim();
    const paySigB = String(body?.paySigB ?? "").trim();

    if (!duelId || !joinedBy || !paySigB) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }

    // Apply join
    await joinDuel({ duelId, joinedBy, paySigB });

    // Read-after-write (important for consistency)
    const duel = await getDuel(duelId);
    if (!duel) return NextResponse.json({ error: "DUEL_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ duel, serverNow: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
