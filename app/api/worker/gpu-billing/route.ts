import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runsyncUrl } from "@/lib/livehost-pool";

// GPU KEEP-ALIVE cron (Vercel cron, every few minutes). For every client whose
// GPU is ON, ping their endpoint's /avatars — a real processed request that
// RESETS Novita's freeTimeout, so the single worker stays alive 24/7 for the
// WHOLE live (no mid-stream drop, no auto-off) until the host manually Turn OFF
// at the Usage/Admin tab. This runs server-side so it keeps the worker warm even
// if the browser tab is closed or the host isn't on the Usage page.
//
// It ALSO stamps gpu_on_at the first time the worker actually answers (billing
// starts at RUNNING, not during the ~7min cold boot). There is NO auto-off here.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const admin = createAdminClient();
  const { data: clients } = await admin
    .from("live_client_config")
    .select("user_id, gpu_on_at, gpu_endpoint_id")
    .eq("gpu_on", true);

  let pinged = 0;
  let nowRunning = 0;
  await Promise.all((clients || []).map(async (c) => {
    if (!c.gpu_endpoint_id) return;
    let ok = false;
    try {
      const r = await fetch(`${runsyncUrl(c.gpu_endpoint_id)}/avatars`, { signal: AbortSignal.timeout(8000) });
      ok = r.ok;
    } catch { ok = false; }
    pinged++;
    // First time the worker answers → billing starts now (running).
    if (ok && !c.gpu_on_at) {
      await admin.from("live_client_config")
        .update({ gpu_on_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("user_id", c.user_id);
      nowRunning++;
    }
  }));

  return NextResponse.json({ ok: true, on: clients?.length || 0, pinged, nowRunning });
}
