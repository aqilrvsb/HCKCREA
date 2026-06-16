import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Client-facing pool assign/release. The studio calls:
//   POST { action: "assign" }  on Play  → returns { url } of a free 5090
//        serverless endpoint, or { error: "all_busy" } if the pool is full.
//   POST { action: "release" } on Stop  → frees the caller's slot.
// The slot stays alive via the session heartbeat (see /api/livehost/session,
// which bumps livehost_pool.last_seen); a crashed client's slot is reclaimed
// by livehost_pool_assign() once its heartbeat goes stale.

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { action, sessionId } = await req.json().catch(() => ({} as any));

  if (action === "assign") {
    const { data, error } = await admin.rpc("livehost_pool_assign", {
      p_user: user.id,
      p_session: sessionId || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const slot = Array.isArray(data) ? data[0] : data;
    if (!slot?.runsync_url) {
      return NextResponse.json({ error: "all_busy" }, { status: 503 });
    }
    return NextResponse.json({ url: String(slot.runsync_url).replace(/\/+$/, ""), endpointId: slot.endpoint_id });
  }

  if (action === "release") {
    // Multi-tab / multi-window safe: never free the slot while the user is still
    // streaming on ANY tab. Only the 20-min idle watchdog calls release, and a
    // background tab's watchdog must not yank a slot another tab is using.
    const { data: act } = await admin
      .from("live_sessions")
      .select("id").eq("user_id", user.id).eq("status", "active").limit(1);
    if (act && act.length) return NextResponse.json({ ok: true, kept: "streaming" });
    const { error } = await admin
      .from("livehost_pool")
      .update({
        status: "free",
        assigned_user_id: null,
        assigned_session_id: null,
        assigned_at: null,
        last_seen: null,
        updated_at: new Date().toISOString(),
      })
      .eq("assigned_user_id", user.id)
      .eq("status", "busy");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
