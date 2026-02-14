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

    const serverNow = Date.now();

    // Keep client click timestamp only as a hint/debug (NOT used for fairness)
    const clientAt = Number(body?.clickedAt);
    const clickedAt = Number.isFinite(clientAt) ? clientAt : serverNow;

    // ✅ duelStore expects { clickedAt }
    const duel = await applyClick({ duelId, who, clickedAt });

    return NextResponse.json({ duel, serverNow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
