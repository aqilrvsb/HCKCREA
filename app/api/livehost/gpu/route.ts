import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { createPoolEndpoint, deletePoolEndpoint } from "@/lib/livehost-pool";
import { deduct } from "@/lib/deduct";

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
    .select("gpu_on, gpu_on_at, gpu_endpoint_id")
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
    since: cfg?.gpu_on_at || null,
    elapsedSec: Math.round(elapsedSec),
    rateHour, minBalance, estCharge, credits,
    ...extra,
  });

  if (action === "status") return status();

  if (action === "on") {
    if (cfg?.gpu_on) return status(); // already on — idempotent
    if (credits < minBalance) {
      return NextResponse.json({
        error: `Kredit tak cukup. Perlu sekurang-kurangnya RM ${minBalance.toFixed(2)} untuk hidupkan GPU.`,
      }, { status: 402 });
    }
    const res = await createPoolEndpoint(`client:${user.id.slice(0, 8)}`);
    if (!res.ok || !res.endpointId) {
      return NextResponse.json({ error: res.error || "GPU create failed" }, { status: 502 });
    }
    const nowIso = new Date().toISOString();
    // Bind the pool row to this user so the studio's assign hands them THIS
    // endpoint (per-client, not round-robin). status="busy" keeps it off the
    // free pool for everyone else.
    await admin.from("livehost_pool").update({
      status: "busy", assigned_user_id: user.id, assigned_at: nowIso, updated_at: nowIso,
    }).eq("endpoint_id", res.endpointId);
    await admin.from("live_client_config").upsert({
      user_id: user.id,
      gpu_on: true, gpu_on_at: nowIso, gpu_endpoint_id: res.endpointId,
      backend_url: res.runsyncUrl, updated_at: nowIso,
    });
    return NextResponse.json({
      on: true, since: nowIso, elapsedSec: 0, rateHour, minBalance, estCharge: 0,
      credits, endpointId: res.endpointId, booting: true,
    });
  }

  if (action === "off") {
    if (!cfg?.gpu_on) return status();
    // Mechanism A: charge the elapsed ON time, then tear the endpoint down to $0.
    if (estCharge > 0) await deduct(user.id, "gpu_session", estCharge);
    if (cfg.gpu_endpoint_id) await deletePoolEndpoint(cfg.gpu_endpoint_id);
    const nowIso = new Date().toISOString();
    await admin.from("live_client_config").update({
      gpu_on: false, gpu_on_at: null, gpu_endpoint_id: null, backend_url: null, updated_at: nowIso,
    }).eq("user_id", user.id);
    const { data: after } = await admin
      .from("profiles").select("credits").eq("id", user.id).single();
    return NextResponse.json({ on: false, charged: estCharge, credits: Number(after?.credits || 0) });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
