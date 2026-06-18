import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { deletePoolEndpoint } from "@/lib/livehost-pool";
import { deduct } from "@/lib/deduct";

// GPU billing safety net (Vercel cron, every ~15 min). Billing is mechanism A
// (charge on OFF), but a client might forget to turn their GPU off / close the
// tab. This cron force-OFFs any ON client whose ACCRUED charge would push them
// below the min-balance floor: it charges the elapsed time, deletes the endpoint
// ($0), and clears the binding. So nobody ever runs a paid GPU into deep
// negative, and abandoned sessions self-stop near the floor.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOUR = 3600;
function num(v: unknown, f: number): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 0 ? n : f;
}

export async function GET() {
  const admin = createAdminClient();
  const rateHour = num(await getSetting<string>("livehost_gpu_rate_hour"), 6);
  const minBalance = num(await getSetting<string>("livehost_min_balance"), 5);

  const { data: clients } = await admin
    .from("live_client_config")
    .select("user_id, gpu_on_at, gpu_endpoint_id")
    .eq("gpu_on", true);

  let stopped = 0;
  for (const c of clients || []) {
    if (!c.gpu_on_at) continue;
    const elapsed = Math.max(0, (Date.now() - new Date(c.gpu_on_at).getTime()) / 1000);
    const charge = Number(((elapsed / HOUR) * rateHour).toFixed(4));
    const { data: prof } = await admin
      .from("profiles").select("credits").eq("id", c.user_id).single();
    const credits = Number(prof?.credits || 0);

    // Still affordable above the floor → leave it running (charged on manual OFF).
    if (credits - charge >= minBalance) continue;

    // Hit the floor → charge what's accrued + tear down to $0.
    if (charge > 0) await deduct(c.user_id, "gpu_session", charge);
    if (c.gpu_endpoint_id) await deletePoolEndpoint(c.gpu_endpoint_id);
    await admin.from("live_client_config").update({
      gpu_on: false, gpu_on_at: null, gpu_endpoint_id: null, backend_url: null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", c.user_id);
    stopped++;
  }

  return NextResponse.json({ ok: true, checked: clients?.length || 0, stopped });
}
