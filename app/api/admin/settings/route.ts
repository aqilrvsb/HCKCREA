import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSettingsCache } from "@/lib/settings";
import { rehostToContent } from "@/lib/b2";

export const runtime = "nodejs";

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
  let value = body?.value;
  if (value === undefined) return NextResponse.json({ error: "Missing value" }, { status: 400 });

  // TnG QR — the uploader forwards to RunningHub, which returns a TEMPORARY
  // Tencent COS URL (24h signed) that expires and 404s (breaks the QR on the
  // top-up page). Rehost it to our own B2 (permanent) before saving. data: URLs
  // and already-B2 URLs pass through untouched.
  if (key === "tng_qr_url" && value && typeof value === "object") {
    const u = String((value as any).url || "");
    if (u && !u.startsWith("data:") && !u.includes("peninglab-content") && !u.includes("peninglab-storage")) {
      try {
        const hosted = await rehostToContent({ url: u, userId: user.id, historyId: `tng-qr-${Date.now()}`, type: "image", fallbackExt: "png" });
        if (hosted && hosted.includes("peninglab-content")) value = { ...(value as any), url: hosted };
      } catch { /* keep original — better a maybe-temp URL than a failed save */ }
    }
  }

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
