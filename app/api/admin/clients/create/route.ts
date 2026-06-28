import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/clients/create
// Admin-only. Creates a brand-new client: an auth user (email + password,
// email pre-confirmed so they can log in immediately) + their profile.
// The on_auth_user_created → handle_new_user trigger mints the base profile
// row; we then apply the admin-chosen plan / credits / expiry / details.
//
// Body: { email, password, full_name?, whatsapp?, plan?, expires_days?, credits? }
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const fullName = String(body?.full_name || "").trim();
  const whatsapp = String(body?.whatsapp || "").trim();
  const plan = String(body?.plan || "free").trim();
  const credits = Number(body?.credits);
  const expiresDays = Number(body?.expires_days);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Create the auth user (email pre-confirmed). full_name passed via metadata
  // so handle_new_user can seed it; we also set it explicitly below.
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });
  if (cErr || !created?.user) {
    const msg = /already.*registered|exists/i.test(cErr?.message || "")
      ? "A user with this email already exists."
      : cErr?.message || "Create user failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const uid = created.user.id;

  const plan_expires_at =
    Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 86400000).toISOString()
      : null;
  const initialCredits = Number.isFinite(credits) && credits >= 0 ? credits : 0;

  // The trigger already inserted the base profile row — update it with the
  // admin's choices. Upsert (onConflict id) so we still succeed if the trigger
  // is ever removed.
  const { error: pErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: uid,
        plan,
        is_active: true,
        full_name: fullName || null,
        whatsapp: whatsapp || null,
        plan_expires_at,
        credits: initialCredits,
      },
      { onConflict: "id" }
    );
  if (pErr) {
    // Roll back the orphan auth user so the admin can retry cleanly.
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  // Log the initial credit grant so it shows in the client's ledger.
  // Best-effort — a ledger hiccup shouldn't fail the whole create.
  if (initialCredits > 0) {
    await admin.from("credit_transactions").insert({
      user_id: uid,
      amount: initialCredits,
      balance_after: initialCredits,
      reason: "admin_topup",
      metadata: { admin: user.id, note: "initial grant on client create" },
    });
  }

  return NextResponse.json({ ok: true, user_id: uid });
}
