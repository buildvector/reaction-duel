import { NextResponse } from "next/server";
import { getDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const duelId = String(url.searchParams.get("duelId") ?? "")
      .trim()
      .toUpperCase();

    if (!duelId) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }

    const duel = await getDuel(duelId);

    if (!duel) {
      return NextResponse.json({ error: "DUEL_NOT_FOUND" }, { status: 404 });
    }

    // Return server time for client sync
    return NextResponse.json({
      duel,
      serverNow: Date.now(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "UNKNOWN" },
      { status: 500 }
    );
  }
}
