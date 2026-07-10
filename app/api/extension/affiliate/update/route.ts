import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/affiliate/update
// Body: { product_id, product_name?, description? }
//
// Lets the extension's Saved Products list edit a product's NAME and
// DESCRIPTION in place. The description feeds the caption/hook generator
// (lib/ugc-post-meta seeds category-matched hooks from product text), so
// a good description = better auto-generated captions.
//
// Guarded to the caller's own products: we only update a
// tiktok_product_cache row whose product_id is in the user's
// user_product_history (i.e. a product they saved).
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productId = String(body?.product_id || "").trim();
  if (!productId) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ownership check — the product must be in this user's saved history.
  const { data: owned } = await admin
    .from("user_product_history")
    .select("product_id")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Not your product" }, { status: 403 });
  }

  const patch: Record<string, any> = {};
  if (typeof body?.description === "string") {
    patch.description = body.description.trim() || null;
  }
  if (typeof body?.product_name === "string" && body.product_name.trim()) {
    patch.product_name = body.product_name.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await admin
    .from("tiktok_product_cache")
    .update(patch)
    .eq("product_id", productId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, product_id: productId, ...patch });
}
