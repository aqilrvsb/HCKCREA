import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/affiliate/save
//
// Body: {
//   productId,
//   productName,
//   productImageUrl,
//   productUrl,
//   price?, rating?, totalSold?, descriptionText?, specifications?
// }
//
// Persists a product the user fetched via the Chrome extension's
// Affiliate tab. Two writes:
//   1. tiktok_product_cache  — UPSERT with source="extension" so the
//      Auto Content dropdown can filter to only extension-fetched
//      records (per user spec — TikHub cache rows stay invisible).
//   2. user_product_history  — UPSERT (user_id, product_id) so the
//      list endpoint can return THIS user's saved products.
//
// Shopee products use the same endpoint — the extension just passes
// the Shopee item ID as productId. Auto-post flow uses product_id to
// tag on TikTok; for Shopee rows this tagging will simply fail (or be
// skipped), but they remain usable as image+description context for
// content generation in the Auto Content dropdown.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const productId = String(body?.productId || "").trim();
  const productName = String(body?.productName || "").trim();
  if (!productId || !productName) {
    return NextResponse.json(
      { error: "productId + productName required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 1. UPSERT cache row. We always overwrite source to "extension" on
  //    extension fetches so a future extension fetch on a TikHub-cached
  //    product flips it into the user-visible dropdown set.
  const cacheRow = {
    product_id: productId,
    raw_url: String(body?.productUrl || "").trim() || null,
    product_name: productName,
    product_image_url: String(body?.productImageUrl || "").trim() || null,
    description: String(body?.descriptionText || "").trim() || null,
    price: String(body?.price || "").trim() || null,
    rating: String(body?.rating || "").trim() || null,
    total_sold: String(body?.totalSold || "").trim() || null,
    category: null,
    source: "extension",
    last_used_at: new Date().toISOString(),
  };

  const { error: cacheErr } = await admin
    .from("tiktok_product_cache")
    .upsert(cacheRow, { onConflict: "product_id" });
  if (cacheErr) {
    return NextResponse.json(
      { error: "Cache upsert failed: " + cacheErr.message },
      { status: 500 }
    );
  }

  // 2. UPSERT user history row
  const { error: histErr } = await admin
    .from("user_product_history")
    .upsert(
      {
        user_id: user.id,
        product_id: productId,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "user_id,product_id" }
    );
  if (histErr) {
    return NextResponse.json(
      { error: "History upsert failed: " + histErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    productId,
    productName,
  });
}
