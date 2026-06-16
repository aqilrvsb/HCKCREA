import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pool lease janitor (Vercel cron). A pool slot is held for the host for 15 min
// of inactivity — closing the tab/browser does NOT free it (so they can come
// back and stream again). This cron frees slots whose last_seen has been stale
// for > 15 min, the server-side backstop for the client 15-min watchdog (which
// can't run once the tab is closed). The Novita worker scales itself to $0 via
// its own freeTimeout (≤1000s, the platform max), so freeing the DB row here
// keeps the slot lease aligned with the GPU warmth + billing warm-window.
const LEASE_SEC = 900; // 15 min

export async function GET() {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - LEASE_SEC * 1000).toISOString();
  const { data, error } = await admin
    .from("livehost_pool")
    .update({
      status: "free",
      assigned_user_id: null,
      assigned_session_id: null,
      assigned_at: null,
      last_seen: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "busy")
    .not("last_seen", "is", null)
    .lt("last_seen", cutoff)
    .select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, freed: data?.length || 0 });
}
