import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/auto-content/save-product
// Saves (upserts) a reusable product preset so the client never re-picks/
// re-types. Stores only references — the attachment images already live in the
// user's Attachments library.
//
// Body: { kind: "affiliate"|"manual", product_id?, product_name, detail?, attachments: string[] }
//   • affiliate: keyed by (user, product_id) — saves the 3 attachment URLs
//   • manual:    keyed by (user, lower(product_name)) — saves name + detail + attachments
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productName = String(body?.product_name || "").trim();
  const detail = body?.detail != null ? String(body.detail).trim() : null;
  const attachments: string[] = Array.isArray(body?.attachments)
    ? body.attachments.filter((u: any) => typeof u === "string" && u.trim()).slice(0, 3)
    : [];

  // Unified model (2026-07-06): the Beg Kuning link decides the bucket.
  // Link present + an extractable product_id → "affiliate" (Beg Kuning
  // Product). No link → "manual" (Tiada Link Product). Client sends
  // beg_kuning_url; legacy callers may still send kind + product_id.
  const begKuningUrl = String(body?.beg_kuning_url || "").trim();
  let productId = body?.product_id ? String(body.product_id).trim() : null;
  if (!productId && begKuningUrl) {
    const m =
      begKuningUrl.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i) ||
      begKuningUrl.match(/\/(\d{13,20})(?:[/?#]|$)/) ||
      begKuningUrl.match(/(\d{13,20})/);
    productId = m ? m[1] : null;
  }
  const kind: "affiliate" | "manual" =
    body?.kind === "affiliate" || productId ? "affiliate" : "manual";

  if (!productName) return NextResponse.json({ error: "product_name required" }, { status: 400 });
  if (kind === "affiliate" && !productId) {
    return NextResponse.json(
      { error: "Link Beg Kuning tak sah — tak jumpa ID produk dalam link." },
      { status: 400 }
    );
  }
  if (attachments.length === 0) {
    return NextResponse.json({ error: "Upload your attachment(s) before saving." }, { status: 400 });
  }
  if (!detail) {
    return NextResponse.json({ error: "Detail Product diperlukan." }, { status: 400 });
  }

  const admin = createAdminClient();

  // ONE product name = ONE row (per user), regardless of bucket. Look up
  // EVERY existing row with this name: update the first, delete the rest.
  // This guarantees no duplicates by name and makes bucket moves (link
  // added/removed) just flip the same row's kind — never a second entry.
  const { data: dupes } = await admin
    .from("saved_products")
    .select("id")
    .eq("user_id", user.id)
    .ilike("product_name", productName)
    .order("updated_at", { ascending: false });
  const ids = (dupes || []).map((d: any) => d.id);

  const row = {
    user_id: user.id,
    kind,
    product_id: productId,
    product_name: productName,
    detail,
    attachments,
    updated_at: new Date().toISOString(),
  };

  if (ids.length > 0) {
    const keepId = ids[0];
    const { error } = await admin.from("saved_products").update(row).eq("id", keepId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (ids.length > 1) {
      // Purge any older duplicates of the same name.
      await admin.from("saved_products").delete().in("id", ids.slice(1));
    }
  } else {
    const { error } = await admin.from("saved_products").insert(row);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, kind });
}
