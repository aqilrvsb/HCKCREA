import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/auto-content/saved-products
//   ?product_id=<id>  → return the single saved affiliate preset for that product
//   ?kind=manual      → list the user's saved manual products (for the dropdown)
//   (no params)       → all saved presets for the user
//
// Used by Auto Content to auto-load a product's name/detail/attachments on
// reselect so the client never redoes the work.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("product_id");
  const kind = url.searchParams.get("kind");

  const admin = createAdminClient();
  let q = admin
    .from("saved_products")
    .select("id, kind, product_id, product_name, detail, attachments, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (productId) q = q.eq("product_id", productId);
  if (kind === "manual" || kind === "affiliate") q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Convenience: when ?product_id is given, also return the single match.
  const items = data || [];
  return NextResponse.json({ ok: true, items, item: productId ? items[0] || null : undefined });
}
