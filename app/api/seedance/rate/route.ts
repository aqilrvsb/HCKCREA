import { NextResponse } from "next/server";
import { getSeedanceRate } from "@/lib/settings";

// GET /api/seedance/rate — admin-set RM-per-second rate for Seedance Fast.
// Used by the Cinema tab (Seedance) to show live cost preview as the user
// drags the duration slider. Non-sensitive pricing info, no auth needed.
export async function GET() {
  const rate = await getSeedanceRate();
  return NextResponse.json({ per_second: rate });
}
