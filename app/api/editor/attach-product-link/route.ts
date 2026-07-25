import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { followShareLinkToProductId } from "@/lib/scraper";

// POST /api/editor/attach-product-link  { product_name, beg_kuning_url }
//
// Turns a MANUAL (no-link) product into a Beg Kuning one: extracts the TikTok
// product_id from the pasted link, stamps it onto EVERY of the user's videos
// for that product (matched by product_name), and flips the saved_products
// preset manual -> affiliate. So after this, all those videos carry the link
// and the product shows in the Beg Kuning list. Owner only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productName = String(body?.product_name || "").trim();
  const url = String(body?.beg_kuning_url || "").trim();
  if (!productName) return NextResponse.json({ error: "product_name diperlukan" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "Link Beg Kuning diperlukan" }, { status: 400 });

  // Extract the product_id from the link (same rule as save-product).
  let productId: string | null = null;
  const m =
    url.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i) ||
    url.match(/\/(\d{13,20})(?:[/?#]|$)/) ||
    url.match(/(\d{13,20})/);
  productId = m ? m[1] : null;
  // Short link (vt/vm.tiktok.com) carries no id — follow the redirect.
  if (!productId && /^https?:\/\/(vt|vm)\.tiktok\.com\//i.test(url)) {
    productId = await followShareLinkToProductId(url);
  }
  if (!productId) {
    return NextResponse.json({ error: "Link Beg Kuning tak sah — tak jumpa ID produk dalam link." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: cnt, error } = await admin.rpc("attach_product_link", {
    uid: user.id,
    pname: productName,
    pid: productId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort: mirror into user_product_history so the Beg Kuning list (and the
  // extension) surface it too. Never fail the request over this.
  try {
    await admin
      .from("user_product_history")
      .upsert({ user_id: user.id, product_id: productId, last_used_at: new Date().toISOString() }, { onConflict: "user_id,product_id" });
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, product_id: productId, updated: Number(cnt) || 0 });
}
