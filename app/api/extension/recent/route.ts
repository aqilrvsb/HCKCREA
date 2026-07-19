import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extension/recent?tab=ugc|auto|original-video|auto-ugc
//     &posted=all|posted|unposted&limit=50&project=<project_id>
//
// Feeds the extension's Auto Post tab (v3.6+: ONE tab with a profile
// [project] picker + source-tab dropdown; pre-3.6 clients send only
// ugc|auto and no project — both keep working unchanged):
//   tab=ugc            → history tab='video'          (Dialog UGC)
//   tab=auto           → history tab='auto'           (Auto Content)
//   tab=original-video → history tab='original-video' (Original Video)
//   tab=auto-ugc       → history tab='auto-ugc'       (Auto UGC / Grok)
// All filtered to status='done'. Optional `project` narrows to one
// PeningLab project. `posted` lets the extension fetch one bucket at a
// time (default = all).
export async function GET(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = (url.searchParams.get("source") || "").trim();
  // v3.9: source=editor — the Auto Post grid pulls ONLY videos prepared in the
  // web Editor (metadata.in_editor=true) that already have text generated
  // (caption stamped). Cover is optional — the TikTok flow falls back to a
  // video frame when there's no cover thumbnail. Spans every source tab.
  const isEditorSource = source === "editor";
  const tabParam = url.searchParams.get("tab") || "ugc";
  const tab = ["auto", "original-video", "auto-ugc", "ugc"].includes(tabParam)
    ? tabParam
    : "ugc";
  const project = (url.searchParams.get("project") || "").trim();
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

  if (isEditorSource) {
    // Editor videos across ALL tabs — filter by the in_editor flag, not tab.
    q = q.eq("type", "video").filter("metadata->>in_editor", "eq", "true");
  } else if (tab === "auto") {
    q = q.eq("tab", "auto");
  } else if (tab === "original-video") {
    q = q.eq("tab", "original-video");
  } else if (tab === "auto-ugc") {
    q = q.eq("tab", "auto-ugc");
  } else {
    // UGC = both the video tab + agent UGC rows. Both store tab='video'
    // currently, with metadata.agent === "ugc" for the agent variant.
    q = q.eq("tab", "video");
  }

  // Profile filter — the extension's Auto Post tab scopes videos to one
  // PeningLab project. Empty/absent = all projects (pre-3.6 behaviour).
  if (project) q = q.eq("project_id", project);

  if (posted === "posted") q = q.eq("posted_to_tiktok", true);
  if (posted === "unposted") q = q.eq("posted_to_tiktok", false);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: "Query failed", detail: error.message },
      { status: 500 }
    );
  }

  // Editor source: keep only rows that have TEXT done (non-empty caption) and
  // aren't a framed-original that's been hidden (its framed replacement carries
  // the caption instead). Done in JS to avoid the PostgREST NULL-filter gotcha.
  const filtered = isEditorSource
    ? (data || []).filter((r: any) => String(r.caption || "").trim().length > 0 && !r.metadata?.hidden_by_frame)
    : (data || []);

  // Strip down to the fields the extension actually uses to render
  // cards. Includes everything needed for auto-post (videoUrl,
  // caption, coverTitle, coverSubtitle, productId, productName).
  //
  // poster_url is the first-frame JPG that settle.ts now extracts +
  // rehosts to B2 after every video lands (see generatePosterAsync).
  // Same B2 image is served to peninglab.com dashboard cards AND the
  // extension's View Videos grid — one source of truth, CDN cached.
  // Legacy rows that settled before this feature shipped won't have
  // metadata.poster_url; the extension falls back to <video preload=
  // none> + IntersectionObserver to render the first frame in-place
  // for those rows.
  const rows = filtered.map((r: any) => ({
    id: r.id,
    type: r.type,
    tab: r.tab,
    prompt_preview: (r.prompt || "").substring(0, 200),
    caption: r.caption || "",
    output_url: r.output_url,
    thumbnail_url: r.thumbnail_url,
    poster_url: r.metadata?.poster_url || null,
    reference_url: r.reference_url,
    duration: r.duration,
    posted_to_tiktok: r.posted_to_tiktok,
    posted_at: r.posted_at,
    created_at: r.created_at,
    cover_title: r.metadata?.cover_title || null,
    cover_subtitle: r.metadata?.cover_subtitle || null,
    // AI-generated 9:16 doodle cover (extension "🎨 Cover"). When present, the
    // TikTok flow uploads THIS as the cover instead of picking a middle frame.
    cover_thumbnail_url: r.metadata?.cover_thumbnail_url || null,
    tiktok_product_id: r.metadata?.tiktok_product_id || null,
    product_name: r.metadata?.product_name || null,
  }));

  return NextResponse.json({ ok: true, rows });
}
