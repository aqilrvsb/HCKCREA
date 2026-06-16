import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

// GPU power control for the logged-in Livehost client's dedicated instance.
// Provider: Novita.ai. API key from app_settings (novita_api_key); instance id
// from the client's live_client_config. Neither ever reaches the browser.

const API = "https://api.novita.ai/gpu-instance/openapi/v1/gpu/instance";

async function novitaState(key: string, id: string): Promise<string> {
  const r = await fetch(`${API}?instanceId=${id}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));
  const data = d?.data || d;
  // Novita statuses: pulling | running | exited (stopped) | toStart...
  const s = String(data?.status || "unknown");
  return s === "exited" ? "stopped" : s;
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("vast_instance_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const id = cfg?.vast_instance_id; // column name is legacy; holds the Novita instance id
  const key = await getSetting<string>("novita_api_key");
  // Pool/serverless clients have no dedicated instance to start/stop — Novita
  // auto-scales. Return a clean 200 (not 503) so the studio shows "serverless"
  // and the browser console stays error-free.
  if (!id) {
    return NextResponse.json({ state: "serverless", note: "auto" });
  }
  if (!key) {
    return NextResponse.json({ state: "serverless", note: "auto" });
  }

  const { action } = await req.json().catch(() => ({ action: "status" }));
  try {
    let note = "";
    if (action === "start" || action === "stop") {
      const r = await fetch(`${API}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.message && !d.id && !d.data) note = String(d.message);
    }
    return NextResponse.json({ state: await novitaState(key, id), note });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
