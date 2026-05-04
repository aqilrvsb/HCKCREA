import { NextResponse } from "next/server";
import { getStorytellingPricing } from "@/lib/settings";

// GET /api/fairytale/pricing — returns the current admin-set rates so
// the Storytelling wizard can display an estimated total cost before
// the user clicks Generate. Public (no auth) since the rates aren't
// secret and the wizard is gated behind login anyway.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pricing = await getStorytellingPricing();
  return NextResponse.json({ ok: true, ...pricing });
}
