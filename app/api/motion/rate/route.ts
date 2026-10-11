import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { priceFor } from "@/lib/deduct";
import { getMotionRate } from "@/lib/settings";
import { MOTION_AD_DURATIONS, MOTION_EDIT_MAX_MB, MOTION_EDIT_MAX_SEC, MOTION_VOICES, adEstimateSec } from "@/lib/motion";

// GET /api/motion/rate — per-second Motion rate for the signed-in user
// (partner markup applied) + the tab's limits, for the live cost preview.
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const rate = user ? await priceFor(user.id, "motion", "motion") : await getMotionRate();
  return NextResponse.json({
    rate,
    ad_durations: MOTION_AD_DURATIONS.map((s) => ({ target: s, estimate_sec: adEstimateSec(s) })),
    edit_max_sec: MOTION_EDIT_MAX_SEC,
    edit_max_mb: MOTION_EDIT_MAX_MB,
    voices: MOTION_VOICES,
  });
}
