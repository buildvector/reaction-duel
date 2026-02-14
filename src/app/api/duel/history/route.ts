import { NextResponse } from "next/server";
import { getHistory } from "@/lib/duelStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pubkey = String(url.searchParams.get("pubkey") ?? "").trim();

    if (!pubkey) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400, headers: noStoreHeaders });
    }

    const duels = await getHistory(pubkey, 10);
    return NextResponse.json({ duels }, { headers: noStoreHeaders });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 500, headers: noStoreHeaders });
  }
}
