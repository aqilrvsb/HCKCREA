import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { priceFor } from "@/lib/deduct";
import { getMotionRate, getSetting } from "@/lib/settings";
import { hiddenModesForUser } from "@/lib/partner-tab-gate";
import { MOTION_AD_DURATIONS, MOTION_EDIT_MAX_MB, MOTION_EDIT_MAX_SEC, MOTION_VOICES, adEstimateSec } from "@/lib/motion";

// GET /api/motion/rate — per-second Motion rate for the signed-in user
// (partner markup applied) + the tab's limits, for the live cost preview.
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const rate = user ? await priceFor(user.id, "motion", "motion") : await getMotionRate();
  const mm = await getSetting<any>("model_motion");
  const brain = mm?.main?.model ? String(mm.main.model) : null;
  const hidden = user ? await hiddenModesForUser(user.id) : [];
  return NextResponse.json({
    rate,
    // per-client switch-off of a Motion mode (profiles.settings.hidden_modes)
    modes: { ad: !hidden.includes("motion-ad"), edit: true },
    ad_durations: MOTION_AD_DURATIONS.map((s) => ({ target: s, estimate_sec: adEstimateSec(s) })),
    edit_max_sec: MOTION_EDIT_MAX_SEC,
    edit_max_mb: MOTION_EDIT_MAX_MB,
    voices: MOTION_VOICES,
    brain,
  });
}
