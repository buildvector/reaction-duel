import { NextResponse } from "next/server";
import { createDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { duelId, createdBy, stakeLamports, feeBps, paySigA } = body as {
      duelId: string;
      createdBy: string;
      stakeLamports: number;
      feeBps: number;
      paySigA: string;
    };

    if (!duelId || !createdBy || !paySigA) {
      return NextResponse.json({ error: "BAD_INPUT" }, { status: 400 });
    }
    if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) {
      return NextResponse.json({ error: "BAD_STAKE" }, { status: 400 });
    }

    const duel = await createDuel({
      duelId: String(duelId).toUpperCase(),
      createdBy,
      stakeLamports: Number(stakeLamports),
      feeBps: Number(feeBps ?? 300),
      paySigA: String(paySigA),
    });

    return NextResponse.json({ duel });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN" }, { status: 400 });
  }
}
