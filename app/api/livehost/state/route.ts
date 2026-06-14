import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Persistent store for the Livehost dashboard's client state — Knowledge
// (products), the Greeting library, saved Templates, and studio settings.
// One JSON blob per user in live_client_config.dashboard_state, keyed by the
// original localStorage key. The browser keeps localStorage as a fast cache,
// but THIS is the source of truth so the data survives cache clears and
// follows the user across devices/browsers.
//
//   GET → { state: { <key>: <rawString>, ... } }
//   PUT → body { state: { <key>: <rawString>, ... } } → upsert

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("live_client_config")
    .select("dashboard_state")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ state: data?.dashboard_state || {} });
}

export async function PUT(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const incoming = body?.state;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }
  // Only persist string values (each is a raw localStorage entry), and cap
  // the total size so a runaway blob can't bloat the row.
  const state: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string") state[k] = v;
  }
  if (JSON.stringify(state).length > 2_000_000) {
    return NextResponse.json({ error: "state too large" }, { status: 413 });
  }

  const admin = createAdminClient();
  // user_id is the 1:1 key for live_client_config (same upsert the
  // greet-config route uses), so this is atomic.
  const { error } = await admin
    .from("live_client_config")
    .upsert({ user_id: user.id, dashboard_state: state }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
