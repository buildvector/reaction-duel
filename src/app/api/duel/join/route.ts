import { NextResponse } from "next/server";
import { joinDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { duelId, joinedBy, paySigB } = body as {
      duelId: string;
      joinedBy: string;
      paySigB: string;
    };

    if (!duelId || !joinedBy || !paySigB) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }

    const duel = await joinDuel({
      duelId: String(duelId).toUpperCase(),
      joinedBy,
      paySigB: String(paySigB),
    });

    return NextResponse.json({ duel });
  } catch (e: any) {
    const msg = e?.message ?? "UNKNOWN";
    const code = msg === "DUEL_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
