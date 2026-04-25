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
    .from("admin_device")
    .select("instance, label, active")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ device: data });
}

export async function POST(req: Request) {
  if (!(await adminGate())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const instance = String(body?.instance || "").trim();
  const label = String(body?.label || "Default").trim();
  if (!instance) return NextResponse.json({ error: "Missing instance" }, { status: 400 });

  const admin = createAdminClient();

  // Single-active model: deactivate all, then upsert by instance
  await admin.from("admin_device").update({ active: false }).neq("instance", "__never__");

  const { data: existing } = await admin
    .from("admin_device")
    .select("id")
    .eq("instance", instance)
    .maybeSingle();

  if (existing) {
    await admin.from("admin_device").update({ active: true, label }).eq("id", existing.id);
  } else {
    await admin.from("admin_device").insert({ instance, label, active: true });
  }

  return NextResponse.json({ ok: true });
}
