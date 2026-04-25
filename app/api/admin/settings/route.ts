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
  const { data } = await admin
    .from("app_settings")
    .select("key, value, description, category")
    .order("category")
    .order("key");
  return NextResponse.json({ rows: data || [] });
}

export async function POST(req: Request) {
  const user = await adminGate();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key || "");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  const value = body?.value;
  if (value === undefined) return NextResponse.json({ error: "Missing value" }, { status: 400 });

  const admin = createAdminClient();
  await admin
    .from("app_settings")
    .update({ value, updated_by: user.id })
    .eq("key", key);

  return NextResponse.json({ ok: true });
}
