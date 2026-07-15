import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/auto-content/saved-products
//   ?product_id=<id>  → return the single saved affiliate preset for that product
//   ?kind=manual      → list the user's saved manual products (for the dropdown)
//   ?kind=affiliate   → Beg Kuning list (see below)
//   (no params)       → all presets for the user
//
// Used by Auto Content to auto-load a product's name/detail/attachments on
// reselect so the client never redoes the work.
//
// BEG KUNING RULE (matches the extension): a product is "Beg Kuning" as long as
// it has a LINK (product_id) saved — nothing else required. So the affiliate
// list is the UNION of:
//   1. app-saved presets (saved_products, kind=affiliate), and
//   2. every product the extension has assigned/used (user_product_history),
//      whose name/detail/image come from tiktok_product_cache.
// Deduped by product_id, with the app-saved preset winning (it carries the
// user's edited detail + up to 3 attachments).
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

  const items: any[] = data || [];

  // Beg Kuning = has a link. Fold in the extension's products (they all carry a
  // product_id → a link), so the app shows the same list the extension does.
  if (kind !== "manual") {
    try {
      let hq = admin
        .from("user_product_history")
        .select("product_id, last_used_at")
        .eq("user_id", user.id)
        .order("last_used_at", { ascending: false })
        .limit(300);
      if (productId) hq = hq.eq("product_id", productId);
      const { data: hist } = await hq;

      const savedIds = new Set(items.filter((i) => i.product_id).map((i) => String(i.product_id)));
      const missing = (hist || [])
        .map((h: any) => String(h.product_id || ""))
        .filter((id) => id && !savedIds.has(id));

      if (missing.length > 0) {
        const { data: cache } = await admin
          .from("tiktok_product_cache")
          .select("product_id, product_name, description, product_image_url, hosted_image_url")
          .in("product_id", missing.slice(0, 300));
        const byId = new Map((cache || []).map((c: any) => [String(c.product_id), c]));
        const lastUsed = new Map((hist || []).map((h: any) => [String(h.product_id), h.last_used_at]));

        for (const id of missing) {
          const c: any = byId.get(id);
          // Skip products with no cached name — nothing useful to show/load.
          if (!c?.product_name) continue;
          const img = c.hosted_image_url || c.product_image_url || null;
          items.push({
            id: `ext:${id}`,
            kind: "affiliate",
            product_id: id,
            product_name: c.product_name,
            detail: c.description || "",
            attachments: img ? [img] : [],
            updated_at: lastUsed.get(id) || null,
            // Marks it as coming from the extension (not an app-saved preset).
            source: "extension",
          });
        }
        items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
      }
    } catch {
      /* extension products are a bonus — never fail the saved list over them */
    }
  }

  // Convenience: when ?product_id is given, also return the single match.
  return NextResponse.json({ ok: true, items, item: productId ? items[0] || null : undefined });
}
