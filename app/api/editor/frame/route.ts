import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { falImageToVideo, falMergeVideos } from "@/lib/fal";
import { rehostToContent, type StorageType } from "@/lib/b2";

// POST /api/editor/frame  { history_ids: string[] }
//
// "Frame" — take each video's generated cover (metadata.cover_thumbnail_url),
// turn it into a 3-second STATIC clip (fal ffmpeg, no AI, no client credit),
// and MERGE it as an intro at the START of the video. The result is a NEW
// "framed" video row that REPLACES the original in the Editor (original hidden;
// Undo Frame → /api/editor/unframe brings it back). cost:0 — billed to our fal
// usage, never the client.
//
// PROCESSED SYNCHRONOUSLY (not in after()) so bulk stays bounded: the CLIENT
// fires per-video with a small concurrency cap, so at most a few fal jobs run
// at once and each request lives inside its own maxDuration budget — instead of
// one request spawning N unbounded background jobs that hammer fal / time out.

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to the plan's max.
export const dynamic = "force-dynamic";

const INTRO_SECONDS = 1;
const MAX_BATCH = 8; // safety cap per request (client normally sends 1)

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : body?.history_id ? [String(body.history_id).trim()] : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });
  ids = ids.slice(0, MAX_BATCH);

  const admin = createAdminClient();
  const { data: sources } = await admin
    .from("history")
    .select("id, user_id, tab, status, output_url, project_id, duration, caption, metadata")
    .in("id", ids)
    .eq("user_id", user.id);
  const rows = sources || [];

  const results: { id: string; status: "done" | "failed" | "skip"; framed_id?: string; reason?: string }[] = [];

  // Sequential within a request — parallelism is the client's job (bounded).
  for (const id of ids) {
    const src = rows.find((r) => r.id === id);
    if (!src) { results.push({ id, status: "skip", reason: "tak dijumpai" }); continue; }

    const meta = (src.metadata || {}) as Record<string, any>;
    const coverUrl = String(meta.cover_thumbnail_url || "").trim();
    const videoUrl = String(src.output_url || "").trim();
    if (src.status !== "done" || !videoUrl) { results.push({ id, status: "skip", reason: "video belum siap" }); continue; }
    if (!coverUrl) { results.push({ id, status: "skip", reason: "tiada cover — jana Cover dulu" }); continue; }
    if (meta.framed_child) { results.push({ id, status: "skip", reason: "sudah di-frame" }); continue; }

    // New framed row — inherits tab/project/caption + the auto-post payload so
    // the framed video is post-ready, and shows in the Editor (in_editor=true).
    const { data: framed } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: src.project_id || null,
        type: "video",
        tab: src.tab,
        status: "pending",
        prompt: "Framed intro + video",
        caption: src.caption || null,
        reference_url: null,
        task_id: null,
        duration: (Number(src.duration) || 8) + INTRO_SECONDS,
        cost: 0,
        metadata: {
          feature: "framed",
          framed_from: src.id,
          frame_status: "queued",
          in_editor: true,
          cover_thumbnail_url: coverUrl,
          cover_title: meta.cover_title || null,
          cover_subtitle: meta.cover_subtitle || null,
          tiktok_product_id: meta.tiktok_product_id || null,
          product_name: meta.product_name || null,
        },
      })
      .select("id")
      .single();
    if (!framed) { results.push({ id, status: "skip", reason: "DB insert gagal" }); continue; }

    const framedId = framed.id;
    const sType: StorageType = src.tab === "auto" ? "auto" : src.tab === "cinema" ? "cinema" : "ugc";

    // Replace immediately: hide the original the moment framing starts.
    await admin.from("history").update({
      metadata: { ...meta, hidden_by_frame: true, framed_child: framedId, in_editor: false },
    }).eq("id", src.id).eq("user_id", user.id);

    const restoreOriginal = async () => {
      const { data: o } = await admin.from("history").select("metadata").eq("id", src.id).maybeSingle();
      const om = (o?.metadata || meta) as Record<string, any>;
      delete om.hidden_by_frame; delete om.framed_child;
      await admin.from("history").update({ metadata: { ...om, in_editor: true } }).eq("id", src.id).eq("user_id", user.id);
    };
    const markFailed = async (msg: string) => {
      await admin.from("history").update({
        status: "failed", error_message: msg,
        metadata: { feature: "framed", framed_from: src.id, frame_status: "failed", in_editor: false },
      }).eq("id", framedId);
      await restoreOriginal();
    };

    try {
      // 1) cover image → 3s static clip (ffmpeg, no AI).
      const clip = await falImageToVideo(coverUrl, INTRO_SECONDS);
      if (!clip.ok || !clip.url) { await markFailed(clip.error || "Intro clip gagal"); results.push({ id, status: "failed", reason: clip.error || "intro gagal" }); continue; }
      // 2) merge [intro, video] → one video (intro plays first).
      const merged = await falMergeVideos([clip.url, videoUrl]);
      if (!merged.ok || !merged.url) { await markFailed(merged.error || "Merge gagal"); results.push({ id, status: "failed", reason: merged.error || "merge gagal" }); continue; }
      // 3) rehost the merged result to our B2.
      const rehosted = await rehostToContent({ url: merged.url, userId: user.id, historyId: framedId, type: sType, fallbackExt: "mp4" });
      // 4) framed row done.
      await admin.from("history").update({
        status: "done", output_url: rehosted, merged_url: rehosted, thumbnail_url: rehosted,
        metadata: {
          feature: "framed", framed_from: src.id, frame_status: "done", framed_at: new Date().toISOString(),
          in_editor: true,
          cover_thumbnail_url: coverUrl,
          cover_title: meta.cover_title || null,
          cover_subtitle: meta.cover_subtitle || null,
          tiktok_product_id: meta.tiktok_product_id || null,
          product_name: meta.product_name || null,
        },
      }).eq("id", framedId);
      results.push({ id, status: "done", framed_id: framedId });
    } catch (e: any) {
      await markFailed(e?.message || "Frame error");
      results.push({ id, status: "failed", reason: e?.message || "error" });
    }
  }

  const done = results.filter((r) => r.status === "done").length;
  return NextResponse.json({ ok: true, done, results });
}
