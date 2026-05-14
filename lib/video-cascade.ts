// Linear 4-tier fallback cascade for Veo 3.1 video generation.
//
//   Tier 1 — p2 (Crun, account A — default key)
//   Tier 2 — p2 (Crun, account B — fallback key) NEW
//   Tier 3 — p1 (GeminiGen, Google direct)
//   Tier 4 — p3 (Mountsea, Veo wrapper)
//
// Two Crun tiers exist because account-level rate limits / quota / queue
// saturation are the most common transient failures, and a second Crun
// account bypasses all of those without changing provider. Same Veo
// pipeline, different credentials. If Crun's platform itself is having
// issues OR the prompt is being filtered, both Crun tiers fail fast and
// we drop to GeminiGen / Mountsea.
//
// `startTier` lets the retry path skip tiers that previously returned
// ok:true at create time but failed downstream during polling — without
// it, retries loop on the same broken tier forever.
//
// Used by: UGC, Auto Content, Cinema (Viral Normal Video), Viral
// Talking Object video step, Extend dialog, AI agent.

import { p1CreateTask } from "@/lib/p1";
import { p2CreateTask } from "@/lib/p2";
import { p3CreateVideo } from "@/lib/p3";
import { getP2Config } from "@/lib/settings";

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
  /** 1-4. Skip tiers BELOW this number. Used by retry to avoid looping
   *  on a tier that accepted at create-time but failed downstream — pass
   *  startTier = (highest_prior_ok_tier + 1). Default 1 = full cascade. */
  startTier?: 1 | 2 | 3 | 4;
};

export type VideoCascadeTierLog = {
  tier: string;
  ok: boolean;
  error?: string;
  /** Number of images sent to the upstream — useful for verifying the
   *  product-ref triplicate behavior. Single product image with r2v
   *  mode should show imageCount: 3 here. */
  imageCount?: number;
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
// `account` only matters for p2: "A" = default key, "B" = secondary key.
async function tryVideoProvider(
  which: VideoCascadeProvider,
  input: VideoCascadeInput,
  account: "A" | "B" = "A"
): Promise<{ ok: boolean; taskId: string | null; error: string | null; model: string }> {
  const { primaryModel, prompt, aspectRatio, imageUrls, imageMode, durationMode, userId } = input;
  try {
    if (which === "p1") {
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
      let apiKeyOverride: string | undefined;
      if (account === "B") {
        const cfg = await getP2Config();
        if (!cfg.keyB) {
          // Key B not configured — bail with a clear error so the
          // cascade falls through to p1/p3 instead of silently
          // re-firing the same default key.
          return {
            ok: false,
            taskId: null,
            error: "p2_key_b not configured in app_settings",
            model: primaryModel,
          };
        }
        apiKeyOverride = cfg.keyB;
      }
      const r = await p2CreateTask({
        model: primaryModel,
        userId,
        prompt,
        imageUrls,
        durationMode,
        aspectRatio,
        imageMode,
        apiKeyOverride,
        // Both A and B want Crun directly — never silently re-route to
        // p1 via the gen_provider toggle.
        forceP2: true,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    const r = await p3CreateVideo({
      prompt,
      model: primaryModel,
      aspectRatio,
      imageUrls,
      imageMode,
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
  const input = triplicateProductRef(rawInput);
  const tierLog: VideoCascadeTierLog[] = [];
  const startTier = Math.max(1, Math.min(4, input.startTier || 1));
  const errs: Record<number, string> = {};
  const imageCount = input.imageUrls?.length || 0;

  // ── Tier 1 — p2 / Crun, account A ─────────────────────────────────
  if (startTier <= 1) {
    const t = await tryVideoProvider("p2", input, "A");
    tierLog.push({
      tier: `1:p2:${input.primaryModel}`,
      ok: t.ok,
      error: t.error ?? undefined,
      imageCount,
    });
    if (t.ok && t.taskId) {
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: "p2",
        actualModel: t.model,
        fallbackUsed: false,
        tierLog,
      };
    }
    errs[1] = t.error || "unknown";
    console.warn(`[video-cascade] tier1 (p2-A) failed: ${t.error}`);
  }

  // ── Tier 2 — p2 / Crun, account B (rate-limit / quota bypass) ─────
  if (startTier <= 2) {
    const t = await tryVideoProvider("p2", input, "B");
    tierLog.push({
      tier: `2:p2:${input.primaryModel}`,
      ok: t.ok,
      error: t.error ?? undefined,
      imageCount,
    });
    if (t.ok && t.taskId) {
      console.warn(`[video-cascade] tier2 (p2-B) saved the row`);
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: "p2",
        actualModel: t.model,
        fallbackUsed: true,
        tierLog,
      };
    }
    errs[2] = t.error || "unknown";
    console.warn(`[video-cascade] tier2 (p2-B) failed: ${t.error}`);
  }

  // ── Tier 3 — p1 / GeminiGen ──────────────────────────────────────
  if (startTier <= 3) {
    const t = await tryVideoProvider("p1", input);
    tierLog.push({
      tier: `3:p1:${input.primaryModel}`,
      ok: t.ok,
      error: t.error ?? undefined,
      imageCount,
    });
    if (t.ok && t.taskId) {
      console.warn(`[video-cascade] tier3 (p1) saved the row`);
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: "p1",
        actualModel: t.model,
        fallbackUsed: true,
        tierLog,
      };
    }
    errs[3] = t.error || "unknown";
    console.warn(`[video-cascade] tier3 (p1) failed: ${t.error}`);
  }

  // ── Tier 4 — p3 / Mountsea ───────────────────────────────────────
  if (startTier <= 4) {
    const t = await tryVideoProvider("p3", input);
    tierLog.push({
      tier: `4:p3:${input.primaryModel}`,
      ok: t.ok,
      error: t.error ?? undefined,
      imageCount,
    });
    if (t.ok && t.taskId) {
      console.warn(`[video-cascade] tier4 (p3) saved the row`);
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: "p3",
        actualModel: t.model,
        fallbackUsed: true,
        tierLog,
      };
    }
    errs[4] = t.error || "unknown";
  }

  return {
    ok: false,
    error: Object.entries(errs)
      .map(([n, e]) => `tier${n}: ${e}`)
      .join("; "),
    tierLog,
  };
}
