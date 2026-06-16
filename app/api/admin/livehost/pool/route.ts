import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPoolEndpoints, deletePoolEndpoint } from "@/lib/livehost-pool";

// Admin: manage the shared Livehost 5090 serverless endpoint POOL.
//   GET            → list pool endpoints + status + live worker health
//   POST {count}   → create N new serverless endpoints (copies envs from ref)
//   DELETE ?id=    → delete one endpoint (Novita + DB row)

async function requireAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const { data: pool } = await admin
    .from("livehost_pool")
    .select("id, endpoint_id, runsync_url, label, status, assigned_user_id, assigned_at, last_seen, created_at")
    .order("created_at", { ascending: true });

  // Resolve the holder's email + whether they're actively streaming (vs warmed-idle).
  const busyIds = [...new Set((pool || []).filter((p) => p.assigned_user_id).map((p) => p.assigned_user_id as string))];
  const emailById = new Map<string, string>();
  const streamingUsers = new Set<string>();
  if (busyIds.length) {
    const [{ data: usersPage }, { data: actSessions }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("live_sessions").select("user_id").in("user_id", busyIds).eq("status", "active"),
    ]);
    for (const u of usersPage?.users || []) emailById.set(u.id, u.email || "");
    for (const s of actSessions || []) streamingUsers.add(s.user_id as string);
  }

  const rows = (pool || []).map((p) => ({
    ...p,
    holder_email: p.assigned_user_id ? emailById.get(p.assigned_user_id) || "" : "",
    streaming: p.assigned_user_id ? streamingUsers.has(p.assigned_user_id) : false,
  }));
  const free = rows.filter((r) => r.status === "free").length;
  const busy = rows.filter((r) => r.status === "busy").length;
  // LEASE_SEC mirrors the 15-min hold (livehost_pool_assign stale + idle cron):
  // a busy slot times out at last_seen + LEASE_SEC. now = server time so the UI
  // can render an accurate live countdown without clock-skew.
  return NextResponse.json({ pool: rows, total: rows.length, free, busy, leaseSec: 900, now: new Date().toISOString() });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { count } = await req.json().catch(() => ({ count: 1 }));
  const n = Math.max(1, Math.min(50, Number(count) || 1));
  const results = await createPoolEndpoints(n);
  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({ created: ok, requested: n, results });
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const res = await deletePoolEndpoint(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
