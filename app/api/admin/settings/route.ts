import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSettingsCache } from "@/lib/settings";

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
  // UPSERT (not just UPDATE) — when a key has never been written before
  // (e.g. brand-new admin setting like fairytale_image_model) the UPDATE
  // would silently do nothing because no row matches. Upserting on `key`
  // creates the row on first save instead.
  const { error: upErr } = await admin
    .from("app_settings")
    .upsert(
      { key, value, updated_by: user.id, category: "general" },
      { onConflict: "key" }
    );
  if (upErr) {
    return NextResponse.json(
      { error: `Save failed: ${upErr.message}` },
      { status: 500 }
    );
  }

  // Invalidate the in-memory cache so the next read sees the new value
  // immediately instead of waiting up to 60s for TTL expiry.
  invalidateSettingsCache();

  return NextResponse.json({ ok: true });
}
