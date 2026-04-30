import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/affiliate/delete
//
// Body: { productId }
//
// Removes the row from user_product_history. The cache row in
// tiktok_product_cache is left intact — other users' history may
// reference it, and deleting global cache from a single-user delete
// would force a re-scrape elsewhere.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
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
