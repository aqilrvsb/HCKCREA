import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extension/recent?tab=ugc|auto&posted=all|posted|unposted&limit=50
//
// Feeds the extension's auto-post tabs:
//   tab=ugc  → history rows where tab='video' (UGC tab + Agent UGC),
//              filter status='done' so only finished videos show up.
//   tab=auto → history rows where tab='auto' (Auto Content batch).
//
// The extension uses this to populate the UGC / Auto Content sub-tabs
// under "Not Posted" and "Posted" sections. `posted` query param lets
// the extension fetch one bucket at a time (default = all).
export async function GET(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "auto" ? "auto" : "ugc";
  const posted = url.searchParams.get("posted") || "all";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));

  const admin = createAdminClient();
  let q = admin
    .from("history")
    .select(
      "id, type, tab, status, prompt, caption, output_url, thumbnail_url, reference_url, duration, posted_to_tiktok, posted_at, created_at, metadata"
    )
    .eq("user_id", user.id)
    .eq("status", "done")
    // Hide rows the user has dismissed from the extension. Migration
    // 0023 adds this column with default FALSE so existing rows are
    // unaffected.
    .eq("dismissed_from_extension", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tab === "auto") {
    q = q.eq("tab", "auto");
  } else {
    // UGC = both the video tab + agent UGC rows. Both store tab='video'
    // currently, with metadata.agent === "ugc" for the agent variant.
    q = q.eq("tab", "video");
  }

  if (posted === "posted") q = q.eq("posted_to_tiktok", true);
  if (posted === "unposted") q = q.eq("posted_to_tiktok", false);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: "Query failed", detail: error.message },
      { status: 500 }
    );
  }

  // Strip down to the fields the extension actually uses to render
  // cards. Includes everything needed for auto-post (videoUrl,
  // caption, coverTitle, coverSubtitle, productId, productName).
  //
  // `poster_url` is a derived field — the real image to show as the
  // card thumbnail in the extension's View Videos grid. `thumbnail_url`
  // on history rows is actually the MP4 URL (settle.ts stamps it that
  // way for video rows so the dashboard can use the same field for
  // hover-preview), so loading it in an <img> tag fails. The actual
  // poster image is one of:
  //   • UGC tab          → reference_url (avatar image generated alongside)
  //   • Auto Content tab → metadata.image_urls[0] (first reference / character
  //                        avatar attached to the batch)
  // Both are B2 S3 URLs (peninglab-content bucket) and are cheap to
  // load lazily as <img>. The extension renders 1000+ cards with these
  // posters without spinning up MP4 decoders → no more crashes.
  const rows = (data || []).map((r: any) => {
    const metaImageUrls = Array.isArray(r.metadata?.image_urls)
      ? r.metadata.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : [];
    const posterUrl =
      r.reference_url ||
      metaImageUrls[0] ||
      r.metadata?.image_url ||
      null;
    return {
      id: r.id,
      type: r.type,
      tab: r.tab,
      prompt_preview: (r.prompt || "").substring(0, 200),
      caption: r.caption || "",
      output_url: r.output_url,
      thumbnail_url: r.thumbnail_url,
      // NEW — real poster image for the extension's card grid.
      poster_url: posterUrl,
      reference_url: r.reference_url,
      duration: r.duration,
      posted_to_tiktok: r.posted_to_tiktok,
      posted_at: r.posted_at,
      created_at: r.created_at,
      cover_title: r.metadata?.cover_title || null,
      cover_subtitle: r.metadata?.cover_subtitle || null,
      tiktok_product_id: r.metadata?.tiktok_product_id || null,
      product_name: r.metadata?.product_name || null,
    };
  });

  return NextResponse.json({ ok: true, rows });
}
