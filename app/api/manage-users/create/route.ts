import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, manageUsersGroup, MANAGED_PLAN, managedPlanExpiry } from "@/lib/manage-users";

// POST /api/manage-users/create
// Allowlisted (canManageUsers) — NOT full admin. Creates a user with name +
// email + password, plan = premium (1 year), NO credit controls. The new user
// is tagged in profiles.settings with created_by_uid so the creator only ever
// sees/edits the users THEY created.
//
// Body: { name, email, password }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Email tak sah." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password mesti sekurang-kurangnya 6 aksara." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { full_name: name } : undefined,
  });
  if (cErr || !created?.user) {
    const msg = /already.*registered|exists/i.test(cErr?.message || "")
      ? "Email ni dah wujud."
      : cErr?.message || "Gagal cipta user.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const uid = created.user.id;

  // Tag ownership + denormalise the email so the creator's list can show it
  // without joining auth.users.
  const { error: pErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: uid,
        plan: MANAGED_PLAN,
        is_active: true,
        full_name: name || null,
        plan_expires_at: managedPlanExpiry(),
        settings: {
          created_by_uid: user.id,
          created_by_email: String(user.email || "").toLowerCase(),
          managed_email: email,
          // Shared-list group — any team member sees users the team created.
          managed_group: manageUsersGroup(user.email),
        },
      },
      { onConflict: "id" }
    );
  if (pErr) {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: uid });
}
