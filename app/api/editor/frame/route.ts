import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { falImageToVideo, falMergeVideos } from "@/lib/fal";
import { rehostToContent, type StorageType } from "@/lib/b2";
import { hasEnoughCredits, deduct } from "@/lib/deduct";
import { generateGrokIntro } from "@/lib/grok-intro";
import { getGrokRate } from "@/lib/settings";
import { withNoIndon } from "@/lib/seedance-lang";

// POST /api/editor/frame
//   { history_ids: string[], mode?: "static"|"animate", duration?: 1..5, animation?: string }
//
// "Frame" — take each video's generated cover (metadata.cover_thumbnail_url),
// turn it into an intro clip, and MERGE it at the START of the video. The result
// is a NEW "framed" row that REPLACES the original in the Editor (Undo Frame →
// /api/editor/unframe restores it).
//
//   • STATIC  — cover held for `duration`s via fal ffmpeg. FREE (billed to fal).
//   • ANIMATE — cover gets a Ken Burns camera move (zoom/pan) + merge, all in
//               ONE Modal call that returns a guaranteed 9:16 merged video.
//               Fixed RM0.10, charged ONLY on success.
//
// Processed synchronously (client fires per-video with a small concurrency cap).

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to the plan's max.
export const dynamic = "force-dynamic";

const MAX_BATCH = 8;
const ANIMATE_COST = 0.10; // fixed RM, any duration
const MODAL_ANIMATE_ENDPOINT =
  process.env.MODAL_ANIMATE_ENDPOINT ||
  "https://aqilrvsb--peninglab-animate-animate-and-merge.modal.run";
const MODAL_MERGE_ENDPOINT =
  process.env.MODAL_MERGE_ENDPOINT ||
  "https://aqilrvsb--peninglab-animate-merge-intro.modal.run";
const MOTIONS = new Set(["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down"]);

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

  const mode: "static" | "animate" | "grok" =
    body?.mode === "animate" ? "animate" : body?.mode === "grok" ? "grok" : "static";
  const animate = mode === "animate";
  const grok = mode === "grok";
  // Grok clips can run longer; static/animate cap at 5s.
  const duration = Math.max(1, Math.min(grok ? 10 : 5, Math.round(Number(body?.duration) || 1)));
  const animation = MOTIONS.has(String(body?.animation)) ? String(body.animation) : "zoom-in";
  // Grok is per-second billed; resolve the rate once for the whole batch.
  const grokRate = grok ? await getGrokRate() : 0;
  const grokCost = grok ? Number((grokRate * duration).toFixed(4)) : 0;

  const admin = createAdminClient();
  const { data: sources } = await admin
    .from("history")
    .select("id, user_id, tab, status, output_url, project_id, duration, caption, metadata")
    .in("id", ids)
    .eq("user_id", user.id);
  const rows = sources || [];

  const results: { id: string; status: "done" | "failed" | "skip"; framed_id?: string; reason?: string }[] = [];

  for (const id of ids) {
    const src = rows.find((r) => r.id === id);
    if (!src) { results.push({ id, status: "skip", reason: "tak dijumpai" }); continue; }

    const meta = (src.metadata || {}) as Record<string, any>;
    const coverUrl = String(meta.cover_thumbnail_url || "").trim();
    const videoUrl = String(src.output_url || "").trim();
    if (src.status !== "done" || !videoUrl) { results.push({ id, status: "skip", reason: "video belum siap" }); continue; }
    if (!coverUrl) { results.push({ id, status: "skip", reason: "tiada cover — jana Cover dulu" }); continue; }
    if (meta.framed_child) { results.push({ id, status: "skip", reason: "sudah di-frame" }); continue; }

    // Paid modes — check credits BEFORE we touch anything (so we never hide the
    // original then fail on money).
    const paidCost = grok ? grokCost : animate ? ANIMATE_COST : 0;
    if (paidCost > 0 && !(await hasEnoughCredits(user.id, paidCost))) {
      results.push({ id, status: "skip", reason: `kredit tak cukup (perlu RM ${paidCost.toFixed(2)})` });
      continue;
    }

    const baseMeta = {
      feature: "framed",
      framed_from: src.id,
      in_editor: true,
      frame_mode: mode,
      frame_animation: animate ? animation : null,
      frame_duration: duration,
      cover_thumbnail_url: coverUrl,
      cover_title: meta.cover_title || null,
      cover_subtitle: meta.cover_subtitle || null,
      tiktok_product_id: meta.tiktok_product_id || null,
      product_name: meta.product_name || null,
    };

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
        duration: (Number(src.duration) || 8) + duration,
        cost: paidCost,
        metadata: { ...baseMeta, frame_status: "queued" },
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
        metadata: { ...baseMeta, in_editor: false, frame_status: "failed" },
      }).eq("id", framedId);
      await restoreOriginal();
    };
    const finishDone = async (outputUrl: string) => {
      await admin.from("history").update({
        status: "done", output_url: outputUrl, merged_url: outputUrl, thumbnail_url: outputUrl,
        metadata: { ...baseMeta, frame_status: "done", framed_at: new Date().toISOString() },
      }).eq("id", framedId);
    };

    try {
      if (grok) {
        // ── GROK — Grok Imagine 1.5 i2v from the cover (start frame), with a
        // prompt built from the headline + subtext, then merge in front of the
        // video (Modal normalizes both to 9:16). Charged per-second on success.
        const headline = String(meta.cover_title || "").trim();
        const subtext = String(meta.cover_subtitle || "").trim();
        const dialog = [headline, subtext].filter(Boolean).join(". ") || "Intro produk UGC.";
        // Malaysian presenter + Bahasa Melayu Malaysia, NEVER Indonesian slang.
        const prompt = withNoIndon(
          `${dialog}. Malaysian presenter and setting, natural Bahasa Melayu Malaysia delivery, vertical 9:16 cinematic UGC intro.`
        );
        const intro = await generateGrokIntro({ coverUrl, prompt, durationSec: duration, userId: user.id });
        if (!intro.ok || !intro.url) {
          await markFailed(intro.error || "Grok gagal");
          results.push({ id, status: "failed", reason: intro.error || "grok gagal" });
          continue;
        }
        const mr = await fetch(MODAL_MERGE_ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intro_url: intro.url, video_url: videoUrl, user_id: user.id, history_id: framedId }),
        });
        const md = await mr.json().catch(() => ({} as any));
        if (!mr.ok || !md?.ok || !md?.url) {
          await markFailed(md?.error || `Merge gagal (${mr.status})`);
          results.push({ id, status: "failed", reason: md?.error || "merge gagal" });
          continue;
        }
        await deduct(user.id, "grok", grokCost, framedId);
        await finishDone(String(md.url));
        results.push({ id, status: "done", framed_id: framedId });
      } else if (animate) {
        // ── ANIMATE — Modal Ken Burns + merge (one call, guaranteed 9:16) ──
        const r = await fetch(MODAL_ANIMATE_ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cover_url: coverUrl, video_url: videoUrl,
            animation, duration_sec: duration,
            user_id: user.id, history_id: framedId,
          }),
        });
        const d = await r.json().catch(() => ({} as any));
        if (!r.ok || !d?.ok || !d?.url) {
          await markFailed(d?.error || `Animate gagal (${r.status})`);
          results.push({ id, status: "failed", reason: d?.error || "animate gagal" });
          continue;
        }
        // Charge ONLY on success.
        await deduct(user.id, "animate", ANIMATE_COST, framedId);
        await finishDone(String(d.url)); // Modal already uploaded to our B2.
        results.push({ id, status: "done", framed_id: framedId });
      } else {
        // ── STATIC — cover held via fal, then fal merge (free) ──
        const clip = await falImageToVideo(coverUrl, duration);
        if (!clip.ok || !clip.url) { await markFailed(clip.error || "Intro clip gagal"); results.push({ id, status: "failed", reason: clip.error || "intro gagal" }); continue; }
        const merged = await falMergeVideos([clip.url, videoUrl]);
        if (!merged.ok || !merged.url) { await markFailed(merged.error || "Merge gagal"); results.push({ id, status: "failed", reason: merged.error || "merge gagal" }); continue; }
        const rehosted = await rehostToContent({ url: merged.url, userId: user.id, historyId: framedId, type: sType, fallbackExt: "mp4" });
        await finishDone(rehosted);
        results.push({ id, status: "done", framed_id: framedId });
      }
    } catch (e: any) {
      await markFailed(e?.message || "Frame error");
      results.push({ id, status: "failed", reason: e?.message || "error" });
    }
  }

  const done = results.filter((r) => r.status === "done").length;
  return NextResponse.json({ ok: true, done, results });
}
