import { NextResponse } from "next/server";
import { getGeminiFlashRate } from "@/lib/settings";

// GET /api/gemini-flash/rate — admin-set PER-SECOND rate for Gemini Omni Flash
// 1.1. Used by the Original Video tab to show a live cost preview (rate ×
// duration) when the Omni Flash chip is active. Non-sensitive pricing info,
// no auth needed. Mirrors /api/gemini/rate.
export const dynamic = "force-dynamic";

export async function GET() {
  const rate = await getGeminiFlashRate();
  return NextResponse.json({ rate });
}
