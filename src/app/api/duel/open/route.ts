import { NextResponse } from "next/server";
import { listOpenDuels } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 25);

    const duels = await listOpenDuels(Number.isFinite(limit) ? Math.max(1, Math.min(50, limit)) : 25);
    return NextResponse.json({ duels });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
