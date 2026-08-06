import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, manageUsersGroup } from "@/lib/manage-users";

// GET /api/manage-users/list
// Allowlisted. Returns ONLY the users this team created (profiles tagged with
// settings.managed_group === the caller's team). Never exposes anyone else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = manageUsersGroup(user.email);
  if (!group) return NextResponse.json({ ok: true, users: [] });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, plan, plan_expires_at, is_active, created_at, settings")
    .filter("settings->>managed_group", "eq", group)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data || []).map((p: any) => ({
    id: p.id,
    name: p.full_name || "",
    email: p.settings?.managed_email || "",
    plan: p.plan,
    plan_expires_at: p.plan_expires_at,
    is_active: p.is_active,
    created_at: p.created_at,
    created_by_email: p.settings?.created_by_email || "",
    // Per-client visible project-tabs (null/[] = all tabs). Set via
    // /api/manage-users/tabs; read by the client dashboard + the API gate.
    visible_tabs: Array.isArray(p.settings?.visible_tabs) ? p.settings.visible_tabs : null,
  }));
  return NextResponse.json({ ok: true, users });
}
