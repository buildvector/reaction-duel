// src/app/api/duel/fund/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Fund route is optional in MVP.
// Keep it as a valid module so Next.js builds cleanly.
export async function POST() {
  return NextResponse.json({ ok: true, note: "fund route not used in MVP" });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
