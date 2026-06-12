import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// LAYER-2 WATCHDOG (server-side fallback). The on-box watchdog (Layer 1)
// self-stops an idle GPU after 8 min; this cron is the safety net in case the
// box-side watchdog dies (tmux crash, streamer hang, box wedged): every 10 min
// it checks each Livehost client's GPU against live_sessions (the billing
// source of truth) and force-stops any GPU that is running with no streaming
// activity in the last IDLE_MIN minutes. An idle GPU can never burn money for
// more than ~20 minutes even in the worst case.

const NOVITA = "https://api.novita.ai/gpu-instance/openapi/v1/gpu/instance";
const IDLE_MIN = 10;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = await getSetting<string>("novita_api_key");
  if (!key) return NextResponse.json({ error: "novita_api_key not set" }, { status: 503 });

  const admin = createAdminClient();
  const { data: cfgs } = await admin
    .from("live_client_config")
    .select("user_id, vast_instance_id")
    .neq("vast_instance_id", "");

  const cutoff = new Date(Date.now() - IDLE_MIN * 60_000).toISOString();
  const results: Record<string, string> = {};

  for (const cfg of cfgs || []) {
    const id = cfg.vast_instance_id;
    try {
      const r = await fetch(`${NOVITA}?instanceId=${id}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      const status = String((d?.data || d)?.status || "unknown");
      if (status !== "running") {
        results[id] = `skip (${status})`;
        continue;
      }
      // Any streaming activity in the window? (active session heartbeat OR a
      // session that started/ended recently — grace for between-stream pauses)
      const { data: recent } = await admin
        .from("live_sessions")
        .select("id")
        .eq("user_id", cfg.user_id)
        .gte("last_seen", cutoff)
        .limit(1);
      if (recent && recent.length > 0) {
        results[id] = "running (active)";
        continue;
      }
      // Idle GPU burning money — force stop.
      await fetch(`${NOVITA}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: id }),
      });
      results[id] = `FORCE-STOPPED (idle > ${IDLE_MIN}min)`;
    } catch (e: any) {
      results[id] = `error: ${String(e?.message || e).slice(0, 80)}`;
    }
  }

  return NextResponse.json({ checked: (cfgs || []).length, results });
}
