import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/scrape/touch { productId }
//
// Lightweight bump for user_product_history.last_used_at so the
// dropdown picker re-orders correctly across sessions. Called by the
// Auto Content tab when the user picks a product from their saved
// dropdown — the full product data is already in memory client-side
// from /api/scrape/recent, so we don't need to round-trip the data
// itself. Just record that the user used it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productId = String(body?.productId || "").trim();
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Upsert with onConflict so this also creates the row if for some
  // reason the user is touching a product they never had in history
  // (defensive — the dropdown sources from history so this branch is
  // unreachable in practice).
  await admin
    .from("user_product_history")
    .upsert(
      { user_id: user.id, product_id: productId, last_used_at: new Date().toISOString() },
      { onConflict: "user_id,product_id" }
    );

  return NextResponse.json({ ok: true });
}
