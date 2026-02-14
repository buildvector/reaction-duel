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

    // Prefer client timestamp (captures actual click moment)
    let clickedAt = Number(body?.clickedAt);

    // Fallback if missing/invalid
    if (!Number.isFinite(clickedAt)) clickedAt = serverNow;

    // Anti-cheat / sanity: keep within a reasonable window of server time
    // (your UI already syncs clock, so this won't hurt legit users)
    const MAX_SKEW_MS = 1500;
    if (clickedAt < serverNow - MAX_SKEW_MS) clickedAt = serverNow - MAX_SKEW_MS;
    if (clickedAt > serverNow + MAX_SKEW_MS) clickedAt = serverNow + MAX_SKEW_MS;

    const duel = await applyClick({ duelId, who, clickedAt });

    return NextResponse.json({ duel, serverNow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
