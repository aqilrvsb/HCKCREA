import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiRate } from "@/lib/settings";
import { hasEnoughCredits } from "@/lib/deduct";
import { p2CreateTask } from "@/lib/p2";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// POST /api/generate/video-ref-multi
//
// Multi-segment GeminiOmni "Video Reference": generate N (2-3) ~10s clips
// from windows of ONE source video, each with its own dialog, then stitch
// them into a single video. Crun (P2) only — its video_list supports the
// per-segment source window (start/ends) that P6 gemini-omni-extend can't.
//
// Design (self-contained, no per-segment history rows):
//   • ONE parent history row (the final stitched video), status=pending,
//     task_id=null, metadata.videoRefMulti=true + segments[].
//   • after() fires N Crun gemini-omni tasks on p2-a in parallel and stamps
//     each task_id into metadata.segments[i].
//   • /api/worker/video-ref-merge polls those task_ids, stitches with
//     falMergeVideos when all done, rehosts, deducts, marks parent done.
//     It also RE-fires any segment whose task never got created (recovery).
//
// Single-segment (1) still goes through /api/generate/cinema.

const GEMINI_MODEL = "google/gemini-omni";

type SegIn = { start: number; ends: number; prompt: string };

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const videoUrl = String(body?.video_url || "").trim();
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const projectId = body?.project_id ? String(body.project_id) : null;
  const productName = String(body?.product_name || "").trim();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x).slice(0, 5)
    : [];

  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    return NextResponse.json({ error: "video_url (public https) required" }, { status: 400 });
  }

  const rawSegs: SegIn[] = Array.isArray(body?.segments)
    ? body.segments
        .map((s: any) => ({
          start: Math.max(0, Math.round(Number(s?.start) || 0)),
          ends: Math.round(Number(s?.ends) || 0),
          prompt: String(s?.prompt || "").trim(),
        }))
        .filter((s: SegIn) => s.prompt.length > 0)
    : [];
  // Normalise windows: ensure ends > start (default +10s).
  const segments = rawSegs
    .slice(0, 3)
    .map((s) => ({ ...s, ends: s.ends > s.start ? s.ends : s.start + 10 }));

  if (segments.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 segments (use /api/generate/cinema for 1)" },
      { status: 400 }
    );
  }

  // Cost = per-10s Gemini rate × segment count.
  const perSeg = await getGeminiRate("10");
  const cost = Number((perSeg * segments.length).toFixed(4));

  if (!(await hasEnoughCredits(user.id, cost))) {
    const admin = createAdminClient();
    const { data: p } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .maybeSingle();
    return NextResponse.json(
      { error: "Insufficient credits", balance: Number(p?.credits ?? 0), needed: cost },
      { status: 402 }
    );
  }

  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "original-video",
      status: "pending",
      prompt: segments.map((s, i) => `Seg ${i + 1}: ${s.prompt}`).join("\n\n").slice(0, 4000),
      reference_url: null,
      task_id: null, // stitched-merge row — polled by the video-ref-merge worker
      duration: segments.length * 10,
      cost,
      metadata: {
        videoRefMulti: true,
        imageMode: "video",
        cinemaProvider: "crun",
        modelChoice: "gemini",
        model: GEMINI_MODEL,
        featureType: "original-video",
        aspectRatio,
        resolution: "1080p",
        refVideoUrl: videoUrl,
        product_name: productName || null,
        image_urls: imageUrls,
        segCount: segments.length,
        segTotalCost: cost,
        merge_status: "segments_firing",
        segments: segments.map((s) => ({
          start: s.start,
          ends: s.ends,
          prompt: s.prompt,
          task_id: null,
          status: "pending",
          output_url: null,
          error: null,
        })),
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }
  const historyId = hist.id;

  // Fire all segment tasks in parallel on p2-a (default Crun key). Storing
  // task_ids back so the merge worker can poll them. If after() dies before
  // this finishes, the worker re-fires any segment left with task_id=null.
  after(async () => {
    const fired = await Promise.all(
      segments.map(async (s) => {
        try {
          const r = await p2CreateTask({
            model: GEMINI_MODEL,
            userId: user.id,
            prompt: s.prompt,
            imageUrls,
            videoUrls: [videoUrl],
            refVideoStart: s.start,
            refVideoEnd: s.ends,
            aspectRatio,
            resolution: "1080p",
            forceP2: true, // p2-a (default key)
          });
          return r.ok && r.task_id
            ? { task_id: String(r.task_id), status: "pending", error: null }
            : { task_id: null, status: "pending", error: r.error || "create failed" };
        } catch (e: any) {
          return { task_id: null, status: "pending", error: e?.message || "create error" };
        }
      })
    );

    // Re-read + merge (avoid clobbering a concurrent worker write).
    const { data: cur } = await admin
      .from("history")
      .select("metadata")
      .eq("id", historyId)
      .maybeSingle();
    const meta = (cur?.metadata || {}) as Record<string, any>;
    const segs = Array.isArray(meta.segments) ? meta.segments : [];
    const merged = segs.map((sg: any, i: number) => ({
      ...sg,
      task_id: sg.task_id || fired[i]?.task_id || null,
      error: sg.error || fired[i]?.error || null,
    }));
    await admin
      .from("history")
      .update({ metadata: { ...meta, segments: merged, merge_status: "segments_firing" } })
      .eq("id", historyId);
  });

  return NextResponse.json({
    ok: true,
    task_id: historyId,
    estimated_cost: cost,
    segments: segments.length,
  });
}
