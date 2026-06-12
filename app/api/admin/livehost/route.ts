import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin: list Livehost clients + set each one's streaming config
// (backend_url = their GPU tunnel URL, vast_instance_id = their GPU).

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
  // all profiles on the livehost plan + their config (if any)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, plan, plan_expires_at")
    .eq("plan", "livehost");
  const ids = (profiles || []).map((p) => p.id);
  const { data: cfgs } = ids.length
    ? await admin.from("live_client_config").select("*").in("user_id", ids)
    : { data: [] as any[] };
  const byId = new Map((cfgs || []).map((c) => [c.user_id, c]));
  // emails live in auth.users — fetch and map
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((usersPage?.users || []).map((u) => [u.id, u.email || ""]));
  return NextResponse.json({
    clients: (profiles || []).map((p) => ({
      id: p.id,
      email: emailById.get(p.id) || "",
      name: p.full_name || "",
      plan: p.plan,
      plan_expires_at: p.plan_expires_at,
      backend_url: byId.get(p.id)?.backend_url || "",
      vast_instance_id: byId.get(p.id)?.vast_instance_id || "",
      notes: byId.get(p.id)?.notes || "",
    })).sort((a, b) => a.email.localeCompare(b.email)),
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { userId, backendUrl, vastInstanceId, notes } = body || {};
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("live_client_config").upsert({
    user_id: userId,
    backend_url: String(backendUrl || "").trim().replace(/\/+$/, ""),
    vast_instance_id: String(vastInstanceId || "").trim(),
    notes: String(notes || ""),
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
