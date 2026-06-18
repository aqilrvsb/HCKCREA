import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { setClientGpu } from "@/lib/livehost-pool";

// GPU ON/OFF + per-hour billing for the logged-in Livehost client's DEDICATED
// always-on GPU (1 GPU = 1 client). Billing model = mechanism A (charge on OFF):
//   • ON  → create a minNum:1 serverless endpoint, bind it to the user, stamp
//           gpu_on_at. From here the worker is always-on (no freeTimeout removal
//           → no mid-stream disconnect). The endpoint is BILLED while ON.
//   • OFF → charge elapsed-time × livehost_gpu_rate_hour, delete the endpoint
//           ($0), clear the binding.
//   • status → current on/off + elapsed + accrued charge so far + rate.
// A safety cron (/api/worker/gpu-billing) force-OFFs any client whose accrued
// charge would drop them below the min-balance threshold (catches abandoned
// sessions / closed tabs so nobody runs a GPU for free / into deep negative).
//
// Novita key + endpoint id never reach the browser (server-only).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 3600;

function num(v: unknown, fallback: number): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { action } = await req.json().catch(() => ({ action: "status" }));

  const { data: cfg } = await admin
    .from("live_client_config")
    .select("gpu_on, gpu_on_at, gpu_endpoint_id, gpu_allowed")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: prof } = await admin
    .from("profiles").select("credits").eq("id", user.id).single();
  const credits = Number(prof?.credits || 0);

  const rateHour = num(await getSetting<string>("livehost_gpu_rate_hour"), 6); // RM/hour
  const minBalance = num(await getSetting<string>("livehost_min_balance"), 5); // RM

  const onAt = cfg?.gpu_on && cfg?.gpu_on_at ? new Date(cfg.gpu_on_at).getTime() : 0;
  const elapsedSec = onAt ? Math.max(0, (Date.now() - onAt) / 1000) : 0;
  const estCharge = Number(((elapsedSec / HOUR) * rateHour).toFixed(4));

  const status = (extra: Record<string, unknown> = {}) => NextResponse.json({
    on: !!cfg?.gpu_on,
    allowed: !!cfg?.gpu_allowed,
    since: cfg?.gpu_on_at || null,
    elapsedSec: Math.round(elapsedSec),
    rateHour, minBalance, estCharge, credits,
    ...extra,
  });

  if (action === "status") return status();

  // NOTE: GPU on/off is ADMIN-controlled (Admin → Livehost). These actions are
  // kept (delegating to the shared helper) for completeness, but the client
  // Billing card is read-only status. Re-read fresh state after toggling.
  if (action === "on" || action === "off") {
    const r = await setClientGpu(user.id, action === "on");
    if (!r.ok) return NextResponse.json({ error: r.error || "failed" }, { status: action === "on" ? 402 : 500 });
    const { data: c2 } = await admin
      .from("live_client_config").select("gpu_on, gpu_on_at, gpu_endpoint_id, gpu_allowed").eq("user_id", user.id).maybeSingle();
    const { data: p2 } = await admin.from("profiles").select("credits").eq("id", user.id).single();
    const on2 = !!c2?.gpu_on;
    const at2 = on2 && c2?.gpu_on_at ? new Date(c2.gpu_on_at).getTime() : 0;
    const el2 = at2 ? Math.max(0, (Date.now() - at2) / 1000) : 0;
    return NextResponse.json({
      on: on2, allowed: !!c2?.gpu_allowed, since: c2?.gpu_on_at || null, elapsedSec: Math.round(el2),
      rateHour, minBalance, estCharge: Number(((el2 / 3600) * rateHour).toFixed(4)),
      credits: Number(p2?.credits || 0), charged: r.charged, booting: action === "on" || undefined,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
