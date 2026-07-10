import { NextResponse } from "next/server";
import { authExtensionUser } from "@/lib/extension-auth";
import { generateUgcPostMeta } from "@/lib/ugc-post-meta";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/ugc/generate-post-meta
// Body: { history_id, product_url? }
//
// Thin wrapper around lib/ugc-post-meta. The same helper is invoked
// fire-and-forget from lib/settle.ts when a UGC row settles to done,
// so by the time the user opens the extension the meta is usually
// already there. Calling this endpoint forces a regeneration (force=true).
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const productUrl = String(body?.product_url || "").trim();
  const productName = String(body?.product_name || "").trim();
  const productDetail = String(body?.product_detail || "").trim();
  const variantSeed = Number(body?.variant_seed) || 0;
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const result = await generateUgcPostMeta(historyId, {
    productUrl,
    productName,
    productDetail,
    variantSeed,
    userIdGuard: user.id,
    force: true,
  });

  if (!result.ok) {
    const status = result.error === "Forbidden"
      ? 403
      : result.error === "Row not found"
        ? 404
        : 502;
    return NextResponse.json({ error: result.error, raw: result.raw }, { status });
  }

  return NextResponse.json({
    ok: true,
    caption: result.caption,
    hashtags: result.hashtags,
    cover_title: result.cover_title,
    cover_subtitle: result.cover_subtitle,
    tiktok_product_id: result.tiktok_product_id,
    product_name: result.product_name,
  });
}
