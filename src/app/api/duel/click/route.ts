import { NextResponse } from "next/server";
import { applyClick } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const duelId = String(body?.duelId ?? "").trim().toUpperCase();
    const who = body?.who === "A" || body?.who === "B" ? body.who : null;

    if (!duelId || !who) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }

    // ✅ CRITICAL: Use SERVER time (prevents clock-skew + cheating)
    const clickedAt = Date.now();

    const duel = await applyClick({ duelId, who, clickedAt });
    return NextResponse.json({ duel, serverNow: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
