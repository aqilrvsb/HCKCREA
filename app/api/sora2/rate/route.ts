import { NextResponse } from "next/server";
import { getSetting, getCinemaRate } from "@/lib/settings";

// GET /api/sora2/rate — admin-set RM-per-second rate for Sora 2.
// Used by the Sora 2 tab to show live cost preview as the user picks
// duration. Falls back to cinema rate × 2 if no dedicated sora2_rate
// is configured (Sora 2 is roughly twice the Grok cost per APIPod
// docs — "more stable but higher unit price").
// Non-sensitive pricing info, no auth needed.
export async function GET() {
  const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
  if (typeof sora2RateSetting?.rate === "number") {
    return NextResponse.json({ rate: sora2RateSetting.rate });
  }
  const cinemaRate = await getCinemaRate();
  return NextResponse.json({ rate: cinemaRate * 2 });
}
