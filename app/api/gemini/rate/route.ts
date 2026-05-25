import { NextResponse } from "next/server";
import { getGeminiRate } from "@/lib/settings";

// GET /api/gemini/rate — admin-set FLAT per-video rate for GeminiOmni (10s).
// Used by Original Video tab to show live cost preview when the GeminiOmni
// chip is active. Mirrors /api/veo/rate. Non-sensitive pricing info, no
// auth needed.
export const dynamic = "force-dynamic";

export async function GET() {
  const rate = await getGeminiRate("10");
  return NextResponse.json({ rate });
}
