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
  // Pull profiles + auth.users emails + approved-affiliate set in parallel
  const [profilesRes, authList, affiliateRows] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, whatsapp, plan, plan_expires_at, is_active, is_admin, credits, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
    // An "approved" row in affiliate_applications keyed to a user_id
    // marks them as an active affiliate. Same signal the dashboard uses
    // to route the WhatsApp group link.
    admin
      .from("affiliate_applications")
      .select("approved_user_id")
      .eq("status", "approved"),
  ]);

  const profiles = profilesRes.data || [];
  const emailById = new Map<string, string>();
  (authList?.data?.users || []).forEach((u: any) =>
    emailById.set(u.id, u.email || "")
  );
  const affiliateSet = new Set<string>(
    (affiliateRows.data || [])
      .map((r: any) => r.approved_user_id as string | null)
      .filter((x): x is string => !!x)
  );

  const clients = profiles.map((p: any) => ({
    ...p,
    email: emailById.get(p.id) || "",
    is_affiliate: affiliateSet.has(p.id),
  }));

  return NextResponse.json({ clients });
}
