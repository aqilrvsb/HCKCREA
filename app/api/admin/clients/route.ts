import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function adminGate() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return null;
  return user;
}

export async function GET() {
  if (!(await adminGate())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  // Pull profiles + auth.users emails (need both)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, whatsapp, plan, plan_expires_at, is_active, is_admin, credits, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  // Match emails from auth.users
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const emailById = new Map<string, string>();
  (authList?.users || []).forEach((u: any) => emailById.set(u.id, u.email || ""));

  const clients = (profiles || []).map((p: any) => ({
    ...p,
    email: emailById.get(p.id) || "",
  }));

  return NextResponse.json({ clients });
}
