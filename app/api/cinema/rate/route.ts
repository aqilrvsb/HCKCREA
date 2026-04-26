import { NextResponse } from "next/server";
import { getCinemaRate } from "@/lib/settings";

// GET /api/cinema/rate — returns the admin-set RM-per-second rate so the
// Cinema tab can show a live cost preview as the user drags the duration
// slider. Cheap read; no auth required since the rate is non-sensitive
// pricing info already shown elsewhere in the UI.
export async function GET() {
  const rate = await getCinemaRate();
  return NextResponse.json({ rate });
}
