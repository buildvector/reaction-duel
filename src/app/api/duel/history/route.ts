import { NextResponse } from "next/server";
import { getHistory } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pubkey = String(url.searchParams.get("pubkey") ?? "").trim();
    const limit = Number(url.searchParams.get("limit") ?? 10);

    if (!pubkey) return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });

    const duels = await getHistory(pubkey, Number.isFinite(limit) ? Math.max(1, Math.min(25, limit)) : 10);
    return NextResponse.json({ duels });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
