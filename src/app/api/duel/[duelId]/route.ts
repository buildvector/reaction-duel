// src/app/api/duel/[duelId]/route.ts
import { NextResponse } from "next/server";
import { getDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { duelId: string } }
) {
  const duelId = String(params?.duelId ?? "").trim().toUpperCase();
  if (!duelId) return NextResponse.json({ error: "DUEL_ID_REQUIRED" }, { status: 400 });

  const duel = await getDuel(duelId);
  return NextResponse.json({ duel: duel ?? null });
}

// Optional: block writes on this route (you don't need it)
export async function POST() {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
