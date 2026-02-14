import { NextResponse } from "next/server";
import { getDuel, setDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { duelId: string } }) {
  const duelId = String(params.duelId || "").toUpperCase();
  if (!duelId) return NextResponse.json({ error: "Missing duelId" }, { status: 400 });

  const duel = await getDuel(duelId);
  if (!duel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ duel });
}

// (valgfrit) admin/debug update
export async function PATCH(req: Request, { params }: { params: { duelId: string } }) {
  const duelId = String(params.duelId || "").toUpperCase();
  const duel = await getDuel(duelId);
  if (!duel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const next = { ...duel, ...body, duelId: duel.duelId };
  await setDuel(next);

  return NextResponse.json({ duel: next });
}
