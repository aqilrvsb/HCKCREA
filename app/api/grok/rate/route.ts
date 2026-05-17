import { NextResponse } from "next/server";
import { getGrokRate } from "@/lib/settings";

// GET /api/grok/rate — admin-set RM-per-second rate for Grok Imagine.
// Used by the Grok tab to show live cost preview as the user drags
// the duration slider. Falls back to the legacy cinema rate if the
// Grok-specific setting is missing (handled inside getGrokRate()).
// Non-sensitive pricing info, no auth needed.
export async function GET() {
  const rate = await getGrokRate();
  return NextResponse.json({ rate });
}
