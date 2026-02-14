// src/app/api/duel/[duelId]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDuel } from "@/lib/duelStore";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ duelId: string }> }
) {
  const { duelId } = await ctx.params;
  const id = String(duelId ?? "").trim().toUpperCase();
  if (!id) return NextResponse.json({ error: "DUEL_ID_REQUIRED" }, { status: 400 });

  const duel = await getDuel(id);
  return NextResponse.json({ duel: duel ?? null });
}

export async function POST() {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
