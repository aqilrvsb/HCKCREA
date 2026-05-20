import { NextResponse } from "next/server";
import { getVeoRate } from "@/lib/settings";

// GET /api/veo/rate — admin-set FLAT per-video rate for Veo 3.1 (8s).
// Used by Original Video tab + any other surface that wants to show
// a live Veo cost preview. Reads rate_veo.per_video_8s from settings
// with the same fallback chain getVeoRate uses (credit-cost defaults).
// Non-sensitive pricing info, no auth needed.
export const dynamic = "force-dynamic";

export async function GET() {
  const rate = await getVeoRate("8");
  return NextResponse.json({ rate });
}
