import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

// GPU power control for the logged-in Livehost client's dedicated instance.
// Vast API key comes from app_settings (admin-managed); instance id from the
// client's live_client_config. Neither ever reaches the browser.

const API = "https://console.vast.ai/api/v0/instances";

async function vastState(key: string, id: string): Promise<string> {
  const r = await fetch(`${API}/${id}/`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const d = await r.json();
  return d?.instances?.cur_state || "unknown";
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
  const id = cfg?.vast_instance_id;
  const key = await getSetting<string>("vast_api_key");
  if (!key || !id) {
    return NextResponse.json({ error: "GPU belum dikonfigurasi oleh admin" }, { status: 503 });
  }

  const { action } = await req.json().catch(() => ({ action: "status" }));
  try {
    let note = "";
    if (action === "start" || action === "stop") {
      const r = await fetch(`${API}/${id}/`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state: action === "start" ? "running" : "stopped" }),
      });
      const d = await r.json().catch(() => ({}));
      // e.g. "resources_unavailable, state change queued" — GPU host busy;
      // Vast starts the box automatically once the GPU frees up.
      if (d && d.success === false && d.msg) note = String(d.msg);
    }
    return NextResponse.json({ state: await vastState(key, id), note });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
