import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!meAdmin?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.user_id || "");
  const isActive = !!body?.is_active;
  if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const admin = createAdminClient();
  await admin.from("profiles").update({ is_active: isActive }).eq("id", userId);

  // If deactivating, force-revoke all their existing sessions
  if (!isActive) {
    try { await admin.auth.admin.signOut(userId); } catch {}
  }

  return NextResponse.json({ ok: true });
}
