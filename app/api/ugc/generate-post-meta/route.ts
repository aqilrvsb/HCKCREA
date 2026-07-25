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
  // "Jana Assign" preserves fields the user already edited and only fills the
  // empty ones. Default TRUE; send fill_only_empty:false to force a full
  // regenerate of every field.
  const fillOnlyEmpty = body?.fill_only_empty === false ? false : true;
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  // The Editor tab sends source:"editor" so it uses its OWN model slot
  // (model_editor_text). Everything else — the extension, settle.ts — keeps
  // model_custom_idea, so tuning the Editor can't disturb them.
  const isEditor = String(body?.source || "").trim() === "editor";
  // Editor "Jana Semula → Detail Product sahaja": write the caption purely from
  // the product info, ignoring the video's own prompt/scene.
  const detailOnly = body?.detail_only === true;
  const fmMode = body?.fm_mode === true;

  const result = await generateUgcPostMeta(historyId, {
    productUrl,
    productName,
    productDetail,
    variantSeed,
    userIdGuard: user.id,
    force: true,
    detailOnly,
    fmMode,
    fillOnlyEmpty,
    ...(isEditor ? { modelKey: "model_editor_text" as const } : {}),
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
