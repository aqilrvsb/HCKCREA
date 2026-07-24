import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, manageUsersGroup } from "@/lib/manage-users";

// POST /api/manage-users/update
// Allowlisted. Update name / email / password of a user THIS team created only
// (settings.managed_group must match the caller's team). No credit / plan / any
// other field is touched. Send only the fields you want changed.
//
// Body: { user_id, name?, email?, password? }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = manageUsersGroup(user.email);
  const body = await req.json().catch(() => ({}));
  const targetId = String(body?.user_id || "").trim();
  if (!targetId) return NextResponse.json({ error: "user_id diperlukan" }, { status: 400 });

  const admin = createAdminClient();

  // Ownership check — the target MUST belong to the caller's team.
  const { data: target } = await admin
    .from("profiles")
    .select("id, full_name, settings")
    .eq("id", targetId)
    .maybeSingle();
  const targetGroup = (target?.settings as any)?.managed_group || null;
  if (!target || !group || targetGroup !== group) {
    return NextResponse.json({ error: "User ni bukan dalam senarai anda." }, { status: 403 });
  }

  const name = body?.name != null ? String(body.name).trim() : undefined;
  const email = body?.email != null ? String(body.email).trim().toLowerCase() : undefined;
  const password = body?.password != null ? String(body.password) : undefined;

  if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Email tak sah." }, { status: 400 });
  }
  if (password !== undefined && password.length > 0 && password.length < 6) {
    return NextResponse.json({ error: "Password mesti sekurang-kurangnya 6 aksara." }, { status: 400 });
  }

  // Auth-side changes (email / password) via the admin API.
  const authPatch: { email?: string; password?: string } = {};
  if (email !== undefined) authPatch.email = email;
  if (password !== undefined && password.length >= 6) authPatch.password = password;
  if (Object.keys(authPatch).length > 0) {
    const { error: aErr } = await admin.auth.admin.updateUserById(targetId, { ...authPatch, email_confirm: true });
    if (aErr) {
      const msg = /already.*registered|exists/i.test(aErr.message || "") ? "Email ni dah dipakai user lain." : aErr.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // Profile-side changes (name + keep the denormalised email in sync).
  const profilePatch: Record<string, any> = {};
  if (name !== undefined) profilePatch.full_name = name || null;
  if (email !== undefined) {
    profilePatch.settings = { ...((target.settings as any) || {}), managed_email: email };
  }
  if (Object.keys(profilePatch).length > 0) {
    const { error: pErr } = await admin.from("profiles").update(profilePatch).eq("id", targetId);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
