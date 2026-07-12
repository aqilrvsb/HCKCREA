import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiRate, getP2Config } from "@/lib/settings";
import { hasEnoughCredits } from "@/lib/deduct";
import { p2CreateTask } from "@/lib/p2";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// POST /api/generate/video-ref-multi
//
// Multi-segment GeminiOmni "Video Reference" → N (2-3) VISIBLE segment
// rows + one final merged row. Crun (P2) only (video_list windowing).
//
// Design:
//   • N real segment history rows (cards): each a gemini-omni video_list
//     gen of one source window. Round-robin across P2 A / P2 B by index.
//     Settled by the normal poll-pending/settle pipeline (so each card
//     shows progress + video + gets deducted).
//   • 1 merge row (the final stitched video), task_id=null.
//   • FIRING IS GATED: at most ONE gemini-omni job in flight PER account
//     (Crun caps concurrent gemini-omni ~1/account → "Internal Error"
//     otherwise). This route fires the first segment on each of P2 A/B with
//     a 3-6s stagger; /api/worker/video-ref-merge fires the next segment for
//     an account only when that account's previous segment is done, and
//     stitches into the merge row when all segments succeed.
//
// Single-segment (1) still goes through /api/generate/cinema.

const GEMINI_MODEL = "google/gemini-omni";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randStaggerMs = () => 3000 + Math.floor(Math.random() * 3000); // 3-6s
const slotForIndex = (i: number): "p2-a" | "p2-b" => (i % 2 === 0 ? "p2-a" : "p2-b");

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
  const segments = rawSegs
    .slice(0, 3)
    .map((s) => ({ ...s, ends: s.ends > s.start ? s.ends : s.start + 10 }));

  if (segments.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 segments (use /api/generate/cinema for 1)" },
      { status: 400 }
    );
  }

  const perSeg = await getGeminiRate("10");
  const totalCost = Number((perSeg * segments.length).toFixed(4));
  if (!(await hasEnoughCredits(user.id, totalCost))) {
    const admin0 = createAdminClient();
    const { data: p } = await admin0
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .maybeSingle();
    return NextResponse.json(
      { error: "Insufficient credits", balance: Number(p?.credits ?? 0), needed: totalCost },
      { status: 402 }
    );
  }

  const admin = createAdminClient();

  // 1) Merge (final) row — task_id=null so poll-pending never touches it;
  //    the video-ref-merge worker drives it.
  const { data: mergeRow, error: mErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "original-video",
      status: "pending",
      prompt: `Merged ${segments.length}-part Video Reference${productName ? ` — ${productName}` : ""}`,
      task_id: null,
      duration: segments.length * 10,
      cost: 0,
      metadata: {
        videoRefMerge: true,
        imageMode: "video",
        cinemaProvider: "crun",
        modelChoice: "gemini",
        model: GEMINI_MODEL,
        featureType: "original-video",
        aspectRatio,
        resolution: "1080p",
        refVideoUrl: videoUrl,
        product_name: productName || null,
        segCount: segments.length,
        merge_status: "waiting_segments",
        segIds: [] as string[],
      },
    })
    .select("id")
    .single();
  if (mErr || !mergeRow) {
    return NextResponse.json({ error: "DB insert failed", detail: mErr?.message }, { status: 500 });
  }
  const mergeId = mergeRow.id;

  // 2) N segment rows (visible cards). Round-robin slot by index.
  const segIds: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const slot = slotForIndex(i);
    const { data: segRow } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: "video",
        tab: "original-video",
        status: "pending",
        prompt: s.prompt,
        task_id: null, // fired below (first per slot) or by the worker (gated)
        duration: 10,
        cost: 0,
        metadata: {
          videoRefSeg: true,
          segIndex: i + 1,
          segCount: segments.length,
          mergeParentId: mergeId,
          imageMode: "video",
          provider: "p2",
          slot,
          model: GEMINI_MODEL,
          modelChoice: "gemini",
          cinemaProvider: "crun",
          featureType: "original-video",
          aspectRatio,
          resolution: "1080p",
          refVideoUrl: videoUrl,
          segStart: s.start,
          segEnd: s.ends,
          seg_prompt: s.prompt,
          seg_attempts: 0,
        },
      })
      .select("id")
      .single();
    if (segRow) segIds.push(segRow.id);
  }

  // Persist segIds onto the merge row so the worker can find its segments.
  {
    const { data: cur } = await admin.from("history").select("metadata").eq("id", mergeId).maybeSingle();
    const meta = (cur?.metadata || {}) as Record<string, any>;
    await admin.from("history").update({ metadata: { ...meta, segIds } }).eq("id", mergeId);
  }

  // 3) Fire the FIRST segment on each account (round-robin), staggered 3-6s.
  after(async () => {
    const cfg = await getP2Config();
    const keyForSlot = (slot: string) => (slot === "p2-b" && cfg.keyB ? cfg.keyB : undefined);

    // First segment per slot = lowest index assigned to that slot.
    const firstA = segments.findIndex((_, i) => slotForIndex(i) === "p2-a");
    const firstB = segments.findIndex((_, i) => slotForIndex(i) === "p2-b");
    const toFire = [firstA, firstB].filter((i) => i >= 0);

    for (let k = 0; k < toFire.length; k++) {
      const i = toFire[k];
      const segId = segIds[i];
      if (!segId) continue;
      const s = segments[i];
      const slot = slotForIndex(i);
      try {
        const r = await p2CreateTask({
          model: GEMINI_MODEL,
          userId: user.id,
          prompt: s.prompt,
          videoUrls: [videoUrl],
          refVideoStart: s.start,
          refVideoEnd: s.ends,
          aspectRatio,
          resolution: "1080p",
          forceP2: true,
          apiKeyOverride: keyForSlot(slot),
        });
        const { data: cur } = await admin.from("history").select("metadata").eq("id", segId).maybeSingle();
        const meta = (cur?.metadata || {}) as Record<string, any>;
        if (r.ok && r.task_id) {
          await admin
            .from("history")
            .update({ task_id: String(r.task_id), metadata: { ...meta, seg_attempts: 1 } })
            .eq("id", segId);
        } else {
          await admin
            .from("history")
            .update({ metadata: { ...meta, seg_error: r.error || "create failed", seg_attempts: 1 } })
            .eq("id", segId);
        }
      } catch (e: any) {
        const { data: cur } = await admin.from("history").select("metadata").eq("id", segId).maybeSingle();
        const meta = (cur?.metadata || {}) as Record<string, any>;
        await admin
          .from("history")
          .update({ metadata: { ...meta, seg_error: e?.message || "create error", seg_attempts: 1 } })
          .eq("id", segId);
      }
      // Stagger the two initial fires 3-6s.
      if (k < toFire.length - 1) await sleep(randStaggerMs());
    }
  });

  return NextResponse.json({
    ok: true,
    task_id: mergeId,
    estimated_cost: totalCost,
    segments: segments.length,
  });
}
