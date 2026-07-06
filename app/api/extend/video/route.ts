import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config, getCinemaRate, getGeminiRate } from "@/lib/settings";
import { priceFor } from "@/lib/deduct";
import { falExtractFrame, type FrameAnchor } from "@/lib/fal";
import { refineFrameWithProduct } from "@/lib/refine-frame";
import { generateVideoWithCascade } from "@/lib/video-cascade";

// POST /api/extend/video — placeholder-first.
//
// Hot path (~500ms):
//   1. getSession + verify source row belongs to user
//   2. Insert seg-2 placeholder row with parent_history_id linking back
//      to the source clip and segment_index=2. The dashboard's segment
//      slider keys on this child row to render the seg-2 placeholder
//      thumb on the parent card immediately — no waiting for fal frame
//      extract, OCR, or Crun create_task.
//   3. Return seg2_history_id
//
// after() background:
//   4. Resolve plan rate
//   5. Extract anchor frame from source video (fal, ~3-5s)
//   6. Run product OCR for text lock (if product image provided)
//   7. Build full seg-2 prompt with locks
//   8. Fire Crun seg-2 create_task
//   9. Update seg-2 row with task_id, cost, locks metadata, ref frame URL
//
// On any failure during after(), the seg-2 row flips to 'failed' with the
// error message so the slider thumb shows a red X instead of forever-spin.
// pg_cron's 10-min stale cutoff catches orphan rows if after() never runs.

export const runtime = "nodejs";
// after() hook budget. Banana Pro refine cascade (p2→p1→p3) can take
// up to 60s × 3 = 180s worst case, plus 5-10s for the Veo create_task
// call afterwards. 60s killed the hook mid-refine and left seg-2
// rows pending forever with no task_id stamped. Bump to 5 minutes so
// the cascade has room to fall through tiers.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const VOICE_MAP: Record<string, string> = {
  achernar: "Achernar — soft, high-pitched, gentle female voice. Light airy timbre.",
  achird: "Achird — friendly, mid-pitch, warm masculine voice.",
  algenib: "Algenib — gravelly, low-pitched, masculine voice. Deep rough timbre.",
  callirrhoe: "Callirrhoe — neutral mid-pitch female voice, natural conversational.",
  charon: "Charon — deep authoritative masculine voice.",
  enceladus: "Enceladus — mature warm female voice, mom-tone.",
  gacrux: "Gacrux — energetic excited masculine voice, hype.",
  iapetus: "Iapetus — young upbeat female voice, Gen Z energy.",
};

const STANDARD_LOCKS = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture, no-makeup-makeup.
VISUAL: RAW UNEDITED FOOTAGE — no subtitles, captions, sticker text, watermarks.

Negative: cartoon, anime, plastic skin, glam makeup, softbox studio lighting, duplicate limbs, distorted fingers, warped product label, text drift, multiple speakers.`;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceHistoryId = String(body?.source_history_id || "");
  const sourceVideoUrl = String(body?.source_video_url || "");
  const sourceDuration = Number(body?.source_duration || 8);
  const bucket = body?.bucket === "cinema" ? "cinema" : body?.bucket === "auto" ? "auto" : "ugc";

  // New frame picker shape (replaces frame_anchor radio):
  //   start_frame_source: "first" | "middle" | "last" | "upload" | "history"
  //   start_frame_url: present when source is "upload" or "history"
  //   end_frame_source / end_frame_url: optional same shape
  // Legacy frame_anchor still accepted as fallback for any old client.
  const startFrameSource =
    (["first", "middle", "last", "upload", "history"].includes(body?.start_frame_source)
      ? body.start_frame_source
      : ["first", "middle", "last"].includes(body?.frame_anchor)
        ? body.frame_anchor
        : "last") as "first" | "middle" | "last" | "upload" | "history";
  const startFrameUrl = body?.start_frame_url ? String(body.start_frame_url) : "";
  const endFrameSource = body?.end_frame_source
    ? String(body.end_frame_source)
    : null;
  const endFrameUrl = body?.end_frame_url ? String(body.end_frame_url) : "";

  // Provider — which model generates seg-2. Default "veo" (legacy behaviour).
  //   • "grok" → Grok i2v from the selected start frame, NO product refine,
  //              user-chosen duration (1-15s slider). Routes through the
  //              dedicated "grok" cascade pool.
  //   • "omni" → GeminiOmni i2v, SAME reference/refine flow as Veo, but the
  //              clip length is fixed 10s (Omni's native length). Routes
  //              through the dedicated "gemini" cascade pool.
  //   • "veo"  → existing Veo i2v + Banana refine + 8→16→24→30 ladder.
  const provider = String(body?.provider || "veo").toLowerCase();
  const isGrokExt = provider === "grok";
  const isOmniExt = provider === "omni";

  // Extension duration. Veo uses the 8→16→24→30 ladder; Grok takes the
  // slider value (1-15s); Omni is fixed 10s.
  const extendSeconds = ((): number => {
    if (isOmniExt) return 10; // Omni fixed 10s
    if (isGrokExt) {
      const r = Math.round(Number(body?.extend_seconds || 0));
      return Math.min(15, Math.max(1, r || 5));
    }
    const requested = Number(body?.extend_seconds || 0);
    if (requested === 6 || requested === 8) return requested;
    if (sourceDuration < 16) return 8;
    if (sourceDuration < 24) return 8;
    if (sourceDuration < 30) return 6;
    return 0; // can't extend further
  })();

  const seg2Prompt = String(body?.seg2_prompt || "").trim();
  // Product text lock UI removed from frontend — backend ALWAYS auto-runs
  // OCR on productImageUrl when it's available, so the user never has to
  // type the package text.
  const productImageUrl = String(body?.product_image_url || "");
  const voiceId = body?.voice ? String(body.voice) : "";
  const aspectRatio = String(body?.aspect_ratio || "9:16");

  if (extendSeconds <= 0) {
    return NextResponse.json(
      { error: "This clip is already at the 30-second cap." },
      { status: 400 }
    );
  }

  if (!sourceHistoryId || !sourceVideoUrl) {
    return NextResponse.json(
      { error: "source_history_id and source_video_url required" },
      { status: 400 }
    );
  }
  if (!seg2Prompt) {
    return NextResponse.json({ error: "seg2_prompt required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify source row belongs to user + is settled (kept on hot path —
  // small + needed to reject hostile callers before we insert).
  const { data: source } = await admin
    .from("history")
    .select("id, user_id, status, project_id, tab, parent_history_id")
    .eq("id", sourceHistoryId)
    .single();
  if (!source || source.user_id !== user.id) {
    return NextResponse.json({ error: "Source clip not found" }, { status: 404 });
  }
  if (source.status !== "done") {
    return NextResponse.json(
      { error: "Source clip is not ready yet — wait for it to finish" },
      { status: 400 }
    );
  }

  // Each Extend adds a SEGMENT to the ORIGINAL card's slider (Seg 2, Seg 3,
  // …) — NO merged clip (agent="extend" makes onSegmentSettled skip merge).
  //   • Root parent = the original video. If the user extends a segment
  //     (which already has a parent), attach the new one to the SAME root so
  //     all segments group under the one original card.
  //   • segment_index = next free index (2, 3, 4, …) so the slider orders +
  //     labels them Seg 2, Seg 3, …
  const rootParentId = (source as any).parent_history_id || sourceHistoryId;
  const { count: existingSegCount } = await admin
    .from("history")
    .select("id", { count: "exact", head: true })
    .eq("parent_history_id", rootParentId);
  const nextSegmentIndex = (existingSegCount ?? 0) + 2;

  const legacyAnchor: FrameAnchor =
    startFrameSource === "first" || startFrameSource === "middle" || startFrameSource === "last"
      ? startFrameSource
      : "last";
  const { data: child, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: source.project_id || null,
      type: "video",
      tab: (source as any).tab || (bucket === "cinema" ? "cinema" : bucket === "auto" ? "auto" : "video"),
      status: "pending",
      prompt: seg2Prompt,
      reference_url: null,
      task_id: null,
      duration: extendSeconds,
      cost: 0,
      segment_index: nextSegmentIndex,
      parent_history_id: rootParentId,
      frame_anchor: legacyAnchor,
      metadata: {
        agent: "extend",
        segment_role: `seg${nextSegmentIndex}`,
        source_history_id: sourceHistoryId,
        bucket,
        aspectRatio,
        extend_seconds: extendSeconds,
        start_frame_source: startFrameSource,
        end_frame_source: endFrameSource,
        // Stamp the canvas-captured start frame URL on the placeholder
        // BEFORE the after() hook runs. If Vercel kills after() at any
        // point — even before the Banana task is submitted — the
        // recover endpoint can fall back to this URL and still fire
        // Veo with a usable start frame.
        anchor_frame_url:
          startFrameSource === "upload" || startFrameSource === "history"
            ? startFrameUrl || null
            : null,
        // For product, same idea — stamp it so recover can pass it to
        // the refine step if it gets re-triggered later.
        product_image_url: productImageUrl || null,
        upload_status: "queued",
      },
    })
    .select("id")
    .single();

  if (insErr || !child) {
    return NextResponse.json(
      { error: "Failed to insert seg-2 placeholder", detail: insErr?.message },
      { status: 500 }
    );
  }

  const childId = child.id;

  after(async () => {
    try {
      // 1. Resolve cost. Extend = Veo seg-2 + optional Banana Pro refine.
      //
      //    Video cost: video_8s rate × (extendSeconds / 8). 8s extend pays
      //    the full 8s rate; 6s extends pay 6/8 × rate.
      //
      //    Refine cost: banana_pro rate ONLY when refine actually fires
      //    (bucket is ugc/auto AND a product image is attached). Cinema
      //    extends + extends without a product skip the refine and aren't
      //    charged for it. The cost is added even if all three refine
      //    tiers fail, because the user got the attempt and admin paid
      //    for whatever did/didn't land — the extra-resolution + frame
      //    upload still ran. Actual recover-seg2 reusing an in-flight
      //    refine task does NOT double-charge (the original extend
      //    cost is already on the row).
      // Per-provider video cost — mirrors the generation routes so the
      // extend charge matches what a fresh clip of the same model costs:
      //   • Grok → cinema per-second rate × extendSeconds
      //   • Omni → flat 10s GeminiOmni rate
      //   • Veo  → video_8s rate × (extendSeconds / 8)
      const videoCost = isGrokExt
        ? Number(((await getCinemaRate()) * extendSeconds).toFixed(4))
        : isOmniExt
          ? Number((await getGeminiRate("10")).toFixed(4))
          : Number(
              ((await priceFor(user.id, "video_8s")) * extendSeconds / 8).toFixed(4)
            );
      // Grok extends use the selected frame directly (no product anchor),
      // so the Banana refine never runs. Omni + Veo keep the refine.
      const willRefine = !isGrokExt && bucket !== "cinema" && !!productImageUrl;
      const refineCost = willRefine
        ? await priceFor(user.id, "image_generate", "banana_pro")
        : 0;
      const cost = Number((videoCost + refineCost).toFixed(4));

      // 2. Resolve start frame URL.
      //    - upload/history → user provided a public URL, use directly
      //    - first/middle/last → extract from source video via fal
      let startUrl = "";
      if (startFrameSource === "upload" || startFrameSource === "history") {
        startUrl = startFrameUrl;
      } else {
        const frameRes = await falExtractFrame(
          sourceVideoUrl,
          startFrameSource as FrameAnchor,
          sourceDuration
        );
        if (!frameRes.ok || !frameRes.url) {
          await admin.from("history").update({
            status: "failed",
            cost,
            error_message: `Start frame extract failed: ${frameRes.error}`,
            metadata: {
              agent: "extend", segment_role: "seg2",
              source_history_id: sourceHistoryId, bucket, aspectRatio,
              extend_seconds: extendSeconds,
              start_frame_source: startFrameSource,
              upload_status: "failed",
            },
          }).eq("id", childId);
          return;
        }
        startUrl = frameRes.url;
      }
      if (!startUrl) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: "Start frame URL missing",
          metadata: {
            agent: "extend", segment_role: "seg2",
            source_history_id: sourceHistoryId, bucket, aspectRatio,
            extend_seconds: extendSeconds,
            upload_status: "failed",
          },
        }).eq("id", childId);
        return;
      }

      // 2b. Resolve end frame URL (optional — Veo currently ignores it but
      //     we extract + persist for future model support / debugging).
      let endUrl = "";
      if (endFrameSource && (endFrameSource === "upload" || endFrameSource === "history")) {
        endUrl = endFrameUrl;
      } else if (endFrameSource && ["first", "middle", "last"].includes(endFrameSource)) {
        const endRes = await falExtractFrame(
          sourceVideoUrl,
          endFrameSource as FrameAnchor,
          sourceDuration
        );
        if (endRes.ok && endRes.url) endUrl = endRes.url;
      }

      // 3. Build seg-2 prompt — send the user's edited textarea VERBATIM.
      //
      // Per user rule: extend = 100% copy from segment 1 prompt. The
      // seg-1 prompt that landed in the textarea ALREADY contains the
      // full VOICE CHARACTER (LOCKED) line from buildVeoLocks, so we
      // do NOT append a separate "Voice direction:" — that would
      // double-stamp the voice and risk Veo picking the wrong one.
      // Likewise, STANDARD_LOCKS is only appended for legacy rows
      // whose prompt was generated BEFORE buildVeoLocks existed
      // (no DIALOG LENGTH LOCK / AUDIO LOCK markers); modern rows
      // already have the comprehensive lock block baked in.
      //
      // voiceId is still tracked in metadata for analytics + so future
      // /admin pages can audit which voice each extend used, but it
      // never re-enters the prompt text.
      const voiceLine = voiceId ? VOICE_MAP[voiceId] : "";
      const promptHasLocks =
        /DIALOG LENGTH LOCK:|AUDIO LOCK:|ANATOMY LOCK:|CLEAN FRAME LOCK|VOICE CHARACTER/.test(
          seg2Prompt
        );
      const fullPrompt =
        seg2Prompt.trim() + (promptHasLocks ? "" : STANDARD_LOCKS);

      // 4. Fire seg-2 Crun task using the resolved start frame.
      // Prefer the i2v model so we can use "frame" mode (start frame =
      // literal first frame of seg-2). Falls back to r2v if i2v isn't
      // configured. Cinema bucket uses Grok i2v.
      const cfg = await getP2Config();
      const model =
        isGrokExt
          ? cfg.grokI2V
          : isOmniExt
            ? "google/gemini-omni"
            : bucket === "cinema"
              ? cfg.grokI2V
              : cfg.videoI2V || cfg.videoR2V;
      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: "Model not configured",
          metadata: {
            agent: "extend", segment_role: "seg2",
            source_history_id: sourceHistoryId, bucket, aspectRatio,
            extend_seconds: extendSeconds,
            upload_status: "failed",
          },
        }).eq("id", childId);
        return;
      }

      // 3b. NANO BANANA PRO REFINE STEP — the cornerstone of v0.7 extend.
      // Before firing Veo, run the HD start frame through Nano Banana Pro
      // with the product attachment as a second reference. Banana edits
      // the frame so the product on screen matches the attachment
      // pixel-for-pixel (label, typography, color) while leaving
      // everything else — person, pose, background, lighting — untouched.
      //
      // Veo r2v then conditions on a frame where the product is already
      // crystal clear, so seg-2 baselines off a sharp anchor instead of
      // re-rendering a soft approximation each frame.
      //
      // Skip for cinema bucket (Grok flow, no product anchor) or if the
      // user didn't attach a product (legacy fallback path).
      let effectiveFrameUrl = startUrl;
      let refineUsed = false;
      let refineError: string | null = null;
      let refineProvider: string | null = null;
      let refineTierLog: string[] | null = null;
      if (!isGrokExt && bucket !== "cinema" && productImageUrl) {
        try {
          const refined = await refineFrameWithProduct({
            frameUrl: startUrl,
            productUrl: productImageUrl,
            aspectRatio,
            // Stamp the Banana task_id + provider onto the seg-2 row as
            // soon as the refine task is accepted upstream. If Vercel
            // kills this after() hook mid-poll, /api/extend/recover-seg2
            // reads (refine_banana_task_id, refine_banana_provider) and
            // RESUMES polling — no second Banana submission, no double
            // charge, and we recover the refined frame we already paid for.
            onTaskAccepted: async ({ taskId, provider }) => {
              try {
                const { data: cur } = await admin
                  .from("history")
                  .select("metadata")
                  .eq("id", childId)
                  .single();
                await admin
                  .from("history")
                  .update({
                    metadata: {
                      ...((cur?.metadata as Record<string, any>) || {}),
                      refine_banana_task_id: taskId,
                      refine_banana_provider: provider,
                      refine_started_at: new Date().toISOString(),
                    },
                  })
                  .eq("id", childId);
              } catch (e: any) {
                console.warn("[extend] stamp banana task_id failed:", e?.message);
              }
            },
          });
          refineTierLog = refined.tierLog || null;
          if (refined.ok) {
            effectiveFrameUrl = refined.url;
            refineUsed = true;
            refineProvider = refined.provider || null;
            console.log(
              `[extend] frame refined via ${refined.provider}/nano-banana-pro:`,
              refined.url.slice(0, 80)
            );
          } else {
            refineError = refined.error;
            console.warn(
              "[extend] Banana refine failed across all tiers, using original frame:",
              refined.error,
              refined.tierLog
            );
          }
        } catch (e: any) {
          refineError = e?.message || "refine threw";
          console.warn("[extend] Banana refine threw:", e?.message);
        }
      }

      // Build ref array — BOOKEND pattern (start frame = end frame =
      // refined attachment). Mirrors what segment-chain.ts does for the
      // 16s auto-extend, so both extend paths produce visually
      // identical seamless cuts:
      //   • start frame = literal first frame of seg-2 (no transition
      //     gap — picks up exactly where seg-1 ended after the user
      //     picked first/middle/last)
      //   • end frame = same image → Veo can't drift late in the clip
      //     because it's locked back to the same anchor pose
      //
      // The refined frame already has the product baked in pixel-perfect
      // (Banana Pro did that work), so we don't attach the product as a
      // separate ref. If refine failed across all tiers we fall back to
      // the raw start frame (still bookended) so the extend still fires.
      const anchorFrame = refineUsed ? effectiveFrameUrl : startUrl;
      const refImages: string[] = [anchorFrame, anchorFrame];
      // Fire seg-2 through the cascade — admin's main + fallback rotation
      // picks the slot. Previously hardcoded to p2CreateTask, which meant
      // a P2 outage / revoked key / out-of-credits broke every Extend
      // click instead of falling through to P1/P4/P5/P6 like seg-1 does.
      // asset="cinema" for cinema bucket (Seedance/Grok pool); everything
      // else falls into the default video pool (Veo r2v + admin's slots).
      const cascaded = await generateVideoWithCascade({
        primaryModel: model,
        userId: user.id,
        prompt: fullPrompt,
        imageUrls: refImages,
        durationMode: String(extendSeconds),
        aspectRatio,
        // i2v "frame" mode for all extend paths — refined anchor is the
        // literal start AND end frame (bookend). No more "ingredient"
        // r2v mode here; that was producing visible seg-1 → seg-2 cuts
        // because Veo interpreted the ref instead of starting from it.
        imageMode: "frame",
        asset: isGrokExt
          ? "grok"
          : isOmniExt
            ? "gemini"
            : bucket === "cinema"
              ? "cinema"
              : "video",
      });
      const created: {
        ok: boolean;
        task_id: string | null;
        error?: string | null;
        provider?: string;
      } = cascaded.ok
        ? { ok: true, task_id: cascaded.taskId, provider: cascaded.actualProvider }
        : { ok: false, task_id: null, error: cascaded.error };

      // 5. Update placeholder with task_id (or fail with upstream error).
      // Stamp `provider` so settle/recheck queries the correct upstream
      // (P1 vs P2) when this seg-2 row is polled later. Without this, the
      // recheck path defaults to P2 and the row stays "pending" forever
      // even though P1 already finished it.
      await admin
        .from("history")
        .update({
          status: created.ok && created.task_id ? "pending" : "failed",
          task_id: created.task_id || null,
          cost,
          prompt: fullPrompt,
          reference_url: startUrl,
          error_message: created.ok ? null : created.error || "Extend P2 create failed",
          metadata: {
            agent: "extend",
            segment_role: "seg2",
            source_history_id: sourceHistoryId,
            anchor_frame_url: startUrl,
            anchor_frame_refined_url: refineUsed ? effectiveFrameUrl : null,
            refine_used: refineUsed,
            refine_provider: refineProvider,
            refine_tier_log: refineTierLog,
            refine_error: refineError,
            // Cost breakdown — handy for admin audit + future refunds
            // if all refine tiers fail and the user wants the image
            // portion credited back.
            cost_breakdown: {
              video: videoCost,
              refine: refineCost,
              total: cost,
            },
            end_frame_url: endUrl || null,
            bucket,
            // Stamp the model family so settle/recheck polls the right
            // upstream + the dashboard per-model counter classifies the
            // seg-2 row correctly (grok / gemini / veo).
            modelChoice: isGrokExt ? "grok" : isOmniExt ? "gemini" : "veo",
            model: cfg.grokI2V && isGrokExt ? cfg.grokI2V : isOmniExt ? "google/gemini-omni" : undefined,
            aspectRatio,
            extend_seconds: extendSeconds,
            start_frame_source: startFrameSource,
            end_frame_source: endFrameSource,
            voice: voiceId || null,
            voice_line: voiceLine || null,
            upload_status: created.ok ? "done" : "failed",
            provider: created.provider || "p2",
            // Cascade trace — which slots were tried, which landed.
            // Mirrors auto-content + segment-chain so admin tooling can
            // tell at a glance whether a fallback fired.
            slot: cascaded.ok ? cascaded.actualSlot : undefined,
            ...(cascaded.ok && cascaded.keyIndex !== undefined
              ? { p6_key_index: cascaded.keyIndex }
              : {}),
            actualModel: cascaded.ok ? cascaded.actualModel : undefined,
            fallback_used: cascaded.ok ? cascaded.fallbackUsed : false,
            tier_log: cascaded.tierLog,
          },
        })
        .eq("id", childId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .eq("id", childId);
    }
  });

  return NextResponse.json({
    ok: true,
    seg2_history_id: childId,
    parent_history_id: sourceHistoryId,
  });
}
