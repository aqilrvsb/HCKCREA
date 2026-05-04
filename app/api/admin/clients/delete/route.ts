import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/clients/delete  { user_id }
//
// Hard-deletes a client account: auth user + profile + all dependent
// rows (history, credit_transactions, payments, storage table). The
// physical assets in B2 are LEFT in place — they're cheap, and a
// surprise full-bucket delete would be hard to recover from. If you
// later want to wipe their B2 folder too, list users/{user_id}/ via
// the existing listUserObjects() helper and call deleteObject() on
// each.
//
// Self-protection: refuse to delete an admin (you'd lock yourself
// out) and refuse to delete the calling user.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: meAdmin } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!meAdmin?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.user_id || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json(
      { error: "You can't delete your own admin account from this UI." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Block deletion of other admins so a single click can't lock the
  // org out. To delete an admin you have to demote them first via the
  // edit modal.
  const { data: target } = await admin
    .from("profiles")
    .select("is_admin, full_name")
    .eq("id", userId)
    .single();
  if (target?.is_admin) {
    return NextResponse.json(
      { error: "Refusing to delete an admin. Demote them first." },
      { status: 400 }
    );
  }

  // Wipe dependent rows BEFORE the auth user — even if the FK is set
  // ON DELETE CASCADE, doing it explicitly is cheap and lets us
  // surface partial-failure errors precisely.
  const tables: Array<{ name: string; col: string }> = [
    { name: "history", col: "user_id" },
    { name: "credit_transactions", col: "user_id" },
    { name: "payments", col: "user_id" },
    { name: "storage", col: "user_id" },
    { name: "saved_prompts", col: "user_id" },
  ];
  for (const t of tables) {
    try {
      await admin.from(t.name).delete().eq(t.col, userId);
    } catch (e: any) {
      console.warn(`[clients/delete] ${t.name} cleanup failed:`, e?.message);
    }
  }

  // Delete profile (FK target for the auth user). If profile.id has
  // ON DELETE CASCADE on the auth FK, this is moot — but explicit is
  // safer.
  await admin.from("profiles").delete().eq("id", userId);

  // Finally drop the auth user.
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return NextResponse.json(
      { error: `Auth delete failed: ${delErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deleted_user_id: userId });
}
