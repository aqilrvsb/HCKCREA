import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scrape/delete { productId }
//
// Removes a row from user_product_history so the product disappears from
// the user's "Your saved products" dropdown in Auto Content. The cache
// row in tiktok_product_cache is left intact — other users may still
// reference it. Cookie-authenticated (browser tab).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const productId = String(body?.productId || "").trim();
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_product_history")
    .delete()
    .eq("user_id", user.id)
    .eq("product_id", productId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
