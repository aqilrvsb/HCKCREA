import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { falImageToVideo, falMergeVideos } from "@/lib/fal";
import { rehostToContent, type StorageType } from "@/lib/b2";

// POST /api/editor/frame  { history_ids: string[] }
//
// "Frame" — take each video's generated cover (metadata.cover_thumbnail_url),
// turn it into a 3-second STATIC clip (fal ffmpeg, no AI, no client credit),
// and MERGE it as an intro at the START of the video. The result is a NEW
// "framed" video row that REPLACES the original in the Editor (the original is
// hidden on success and can be brought back with Undo Frame → /api/editor/unframe).
//
// Placeholder-first + after() (mirrors /api/merge/videos). cost:0 — billed to
// our fal usage, never the client.

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to the plan's max.
export const dynamic = "force-dynamic";

const INTRO_SECONDS = 3;
const MAX_BATCH = 50;

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
  const started: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const src of rows) {
    const meta = (src.metadata || {}) as Record<string, any>;
    const coverUrl = String(meta.cover_thumbnail_url || "").trim();
    const videoUrl = String(src.output_url || "").trim();
    if (src.status !== "done" || !videoUrl) { skipped.push({ id: src.id, reason: "video belum siap" }); continue; }
    if (!coverUrl) { skipped.push({ id: src.id, reason: "tiada cover — jana Cover dulu" }); continue; }
    if (meta.framed_child) { skipped.push({ id: src.id, reason: "sudah di-frame" }); continue; }

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
    if (!framed) { skipped.push({ id: src.id, reason: "DB insert gagal" }); continue; }

    const framedId = framed.id;
    started.push(framedId);
    const sType: StorageType = src.tab === "auto" ? "auto" : src.tab === "cinema" ? "cinema" : "ugc";

    // Replace immediately: hide the original the moment framing starts (the
    // pending framed row shows in its place). If framing fails, after() restores
    // it — and even a hard crash leaves the failed framed card in the Editor with
    // an Undo Frame button, so the original is always recoverable.
    await admin.from("history").update({
      metadata: { ...meta, hidden_by_frame: true, framed_child: framedId, in_editor: false },
    }).eq("id", src.id).eq("user_id", user.id);

    after(async () => {
      const fail = async (msg: string) => {
        // Mark the framed row failed + hide it, and bring the original back.
        await admin.from("history").update({
          status: "failed", error_message: msg,
          metadata: { feature: "framed", framed_from: src.id, frame_status: "failed", in_editor: false },
        }).eq("id", framedId);
        const { data: o } = await admin.from("history").select("metadata").eq("id", src.id).maybeSingle();
        const om = (o?.metadata || meta) as Record<string, any>;
        delete om.hidden_by_frame; delete om.framed_child;
        await admin.from("history").update({ metadata: { ...om, in_editor: true } }).eq("id", src.id).eq("user_id", user.id);
      };
      try {
        // 1) cover image → 3s static clip (ffmpeg, no AI).
        const clip = await falImageToVideo(coverUrl, INTRO_SECONDS);
        if (!clip.ok || !clip.url) return void (await fail(clip.error || "Intro clip gagal"));
        // 2) merge [intro, video] → one video (intro plays first).
        const merged = await falMergeVideos([clip.url, videoUrl]);
        if (!merged.ok || !merged.url) return void (await fail(merged.error || "Merge gagal"));
        // 3) rehost the merged result to our B2 (same as every generation).
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
        // 5) hide the ORIGINAL — framed replaces it in the Editor. Merge fresh
        // metadata so nothing else is lost.
        const { data: cur } = await admin.from("history").select("metadata").eq("id", src.id).maybeSingle();
        const m2 = (cur?.metadata || meta) as Record<string, any>;
        await admin.from("history").update({
          metadata: { ...m2, hidden_by_frame: true, framed_child: framedId, in_editor: false },
        }).eq("id", src.id).eq("user_id", user.id);
      } catch (e: any) {
        await fail(e?.message || "Frame error");
      }
    });
  }

  return NextResponse.json({ ok: true, started: started.length, skipped });
}
