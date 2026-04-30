import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extension/affiliate/list
//
// Returns the current user's Affiliate tab saved products — i.e. rows
// in user_product_history joined with tiktok_product_cache where the
// cache row was scraped via the extension (source="extension"). Per the
// product spec, the Auto Content dropdown shows ONLY extension-fetched
// products (not TikHub-cached ones), so we filter by source server-side.
export async function GET(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: history, error: histErr } = await admin
    .from("user_product_history")
    .select("product_id, last_used_at")
    .eq("user_id", user.id)
    .order("last_used_at", { ascending: false })
    .limit(200);

  if (histErr) {
    return NextResponse.json({ error: histErr.message }, { status: 500 });
  }
  if (!history || history.length === 0) {
    return NextResponse.json({ ok: true, products: [] });
  }

  const productIds = history.map((h) => h.product_id);
  const { data: cache, error: cacheErr } = await admin
    .from("tiktok_product_cache")
    .select(
      "product_id, raw_url, product_name, product_image_url, hosted_image_url, price, rating, total_sold, source"
    )
    .in("product_id", productIds)
    .eq("source", "extension"); // only extension-fetched rows visible

  if (cacheErr) {
    return NextResponse.json({ error: cacheErr.message }, { status: 500 });
  }

  // Preserve history order — cache.in() returns arbitrary order
  const cacheById = new Map((cache || []).map((c) => [c.product_id, c]));
  const products = history
    .map((h) => cacheById.get(h.product_id))
    .filter(Boolean);

  return NextResponse.json({ ok: true, products });
}
