// Linear 3-tier fallback cascade for Veo 3.1 video generation.
//
// Different from image-cascade.ts: video cascade is linear (p2 → p1 → p3),
// not conditional, because:
//   • Veo is the same model family across all 3 providers — there's no
//     "swap to a different model with different filter" angle like
//     image has (nano-banana vs imagen vs gpt-image).
//   • Mountsea (p3) and GeminiGen (p1) both wrap Google's Veo directly,
//     while Crun (p2) goes through its own pipeline. So if Crun fails
//     for a transient reason, GeminiGen is usually the cleanest fallback.
//
// Used by: UGC, Auto Content, Cinema (Viral Normal Video), Viral
// Talking Object video step, AI agent (which calls one of those).

import { p1CreateTask } from "@/lib/p1";
import { p2CreateTask } from "@/lib/p2";
import { p3CreateVideo } from "@/lib/p3";

export type VideoCascadeProvider = "p1" | "p2" | "p3";

export type VideoCascadeInput = {
  /** Veo model name in p2/Crun format, e.g. "google/veo-3.1-fast/r2v".
   *  Mapped to provider-specific names internally. */
  primaryModel: string;
  prompt: string;
  aspectRatio?: string;
  imageUrls?: string[];
  /** Veo's image mode — passed to p1/p2 which use this to pick endpoint
   *  variants. p3 auto-detects from imageUrls count. */
  imageMode?: "frame" | "ingredient" | "text";
  /** Duration in seconds. Veo 3.1 fast = 8s only; quality variants 6/8. */
  durationMode?: string | number;
  userId?: string;
};

export type VideoCascadeTierLog = {
  tier: string;
  ok: boolean;
  error?: string;
};

export type VideoCascadeResult =
  | {
      ok: true;
      taskId: string;
      actualProvider: VideoCascadeProvider;
      actualModel: string;
      fallbackUsed: boolean;
      tierLog: VideoCascadeTierLog[];
    }
  | {
      ok: false;
      error: string;
      tierLog: VideoCascadeTierLog[];
    };

// Helper — try one provider, returns uniform shape regardless of upstream.
async function tryVideoProvider(
  which: VideoCascadeProvider,
  input: VideoCascadeInput
): Promise<{ ok: boolean; taskId: string | null; error: string | null; model: string }> {
  const { primaryModel, prompt, aspectRatio, imageUrls, imageMode, durationMode, userId } = input;
  try {
    if (which === "p1") {
      // p1 (GeminiGen) — normalises model internally; pass primary model
      // and let p1.ts strip to "veo-3.1-fast" / etc. No userId param —
      // p1 doesn't track per-user; settle.ts deducts when the task settles.
      const r = await p1CreateTask({
        model: primaryModel,
        prompt,
        imageUrls,
        durationMode,
        aspectRatio,
        imageMode,
      });
      return {
        ok: r.ok,
        taskId: r.task_id ?? null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    if (which === "p2") {
      const r = await p2CreateTask({
        model: primaryModel,
        userId,
        prompt,
        imageUrls,
        durationMode,
        aspectRatio,
        imageMode,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    // p3 — Mountsea wraps Veo. The primary model name gets mapped to
    // Mountsea's bare key (veo31_fast / veo31_quality / etc.) inside
    // p3CreateVideo.
    const r = await p3CreateVideo({
      prompt,
      model: primaryModel,
      aspectRatio,
      imageUrls,
    });
    return {
      ok: r.ok,
      taskId: r.ok ? (r.task_id ?? null) : null,
      error: r.ok ? null : (r.error ?? null),
      model: primaryModel,
    };
  } catch (e: any) {
    return {
      ok: false,
      taskId: null,
      error: e?.message || String(e),
      model: primaryModel,
    };
  }
}

// Product-reference triplicate: when a single image is uploaded with
// "ingredient" / r2v mode, copy it 3× so the model anchors more tightly
// to the product. Applied AT THE CASCADE LEVEL so all 3 tiers (p1/p2/p3)
// benefit from the same anchoring. Skipped when:
//   • multiple images already provided (intentional distinct refs)
//   • i2v / frame mode (single image is a literal first-frame seed)
//   • text mode (no images at all)
//
// For p3/Mountsea: 3 images automatically routes to ingredients2video
// endpoint with model=veo31_fast_ingredients — equivalent to r2v on p2.
function triplicateProductRef(input: VideoCascadeInput): VideoCascadeInput {
  const imgs = input.imageUrls || [];
  if (imgs.length !== 1) return input;
  // Only r2v / ingredient mode benefits from triplication.
  const isR2V =
    input.imageMode === "ingredient" ||
    input.primaryModel.toLowerCase().includes("r2v");
  if (!isR2V) return input;
  return { ...input, imageUrls: [imgs[0], imgs[0], imgs[0]] };
}

export async function generateVideoWithCascade(
  rawInput: VideoCascadeInput
): Promise<VideoCascadeResult> {
  // Triplicate single product ref ONCE at the top so every tier sees
  // the same 3× array.
  const input = triplicateProductRef(rawInput);
  const tierLog: VideoCascadeTierLog[] = [];

  // ── Tier 1: p2 (Crun) — current default ──
  const t1 = await tryVideoProvider("p2", input);
  tierLog.push({
    tier: `1:p2:${input.primaryModel}`,
    ok: t1.ok,
    error: t1.error ?? undefined,
  });
  if (t1.ok && t1.taskId) {
    return {
      ok: true,
      taskId: t1.taskId,
      actualProvider: "p2",
      actualModel: t1.model,
      fallbackUsed: false,
      tierLog,
    };
  }
  console.warn(`[video-cascade] tier1 (p2/${input.primaryModel}) failed: ${t1.error}`);

  // ── Tier 2: p1 (GeminiGen) — Veo 3.1 ──
  const t2 = await tryVideoProvider("p1", input);
  tierLog.push({
    tier: `2:p1:${input.primaryModel}`,
    ok: t2.ok,
    error: t2.error ?? undefined,
  });
  if (t2.ok && t2.taskId) {
    console.warn(`[video-cascade] tier2 (p1) saved the row`);
    return {
      ok: true,
      taskId: t2.taskId,
      actualProvider: "p1",
      actualModel: t2.model,
      fallbackUsed: true,
      tierLog,
    };
  }
  console.warn(`[video-cascade] tier2 (p1) failed: ${t2.error}`);

  // ── Tier 3: p3 (Mountsea) — Veo 3.1 ──
  const t3 = await tryVideoProvider("p3", input);
  tierLog.push({
    tier: `3:p3:${input.primaryModel}`,
    ok: t3.ok,
    error: t3.error ?? undefined,
  });
  if (t3.ok && t3.taskId) {
    console.warn(`[video-cascade] tier3 (p3) saved the row`);
    return {
      ok: true,
      taskId: t3.taskId,
      actualProvider: "p3",
      actualModel: t3.model,
      fallbackUsed: true,
      tierLog,
    };
  }

  // All 3 tiers failed — caller marks row failed, no further retries.
  return {
    ok: false,
    error: `tier1(p2): ${t1.error}; tier2(p1): ${t2.error}; tier3(p3): ${t3.error}`,
    tierLog,
  };
}
