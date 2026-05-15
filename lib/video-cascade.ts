// Linear 2-tier fallback cascade for Veo + Grok video generation.
//
//   Tier 1 — p2 (Crun, account A — default key)
//   Tier 2 — p2 (Crun, account B — fallback key)
//
// Both tiers hit the same Crun pipeline; only the credentials differ.
// Account-level rate limits / quota / queue saturation are the most
// common transient failures, and a second Crun account bypasses all of
// those without changing provider. If Crun itself is down OR the prompt
// is being filtered, both tiers fail fast and the row is marked failed
// — no further fallback. p1 (GeminiGen) and p3 (Mountsea) were
// removed from the video cascade per user direction: the spend was
// unpredictable and Crun's two-account setup already covers the
// realistic outage modes.
//
// `startTier` lets the retry path skip tier 1 if it previously returned
// ok:true at create time but failed downstream during polling — without
// it, retries loop on the same broken tier forever.
//
// Used by: UGC, Auto Content, Cinema (Viral Normal Video), Viral
// Talking Object video step, Extend dialog, AI agent.

import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";

export type VideoCascadeProvider = "p2";

export type VideoCascadeInput = {
  /** Veo or Grok model name in p2/Crun format, e.g.
   *  "google/veo-3.1-fast/r2v" or "grok-imagine/i2v". */
  primaryModel: string;
  prompt: string;
  aspectRatio?: string;
  imageUrls?: string[];
  /** Veo's image mode — passed to p2 which uses this to pick endpoint
   *  variants. */
  imageMode?: "frame" | "ingredient" | "text";
  /** Duration in seconds. Veo 3.1 fast = 8s only; quality variants 6/8. */
  durationMode?: string | number;
  userId?: string;
  /** 1-2. Skip tier 1 if 2. Used by retry to avoid looping on a tier
   *  that accepted at create-time but failed downstream — pass
   *  startTier = (highest_prior_ok_tier + 1). Default 1 = full cascade. */
  startTier?: 1 | 2;
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

// Try one p2 account, returns uniform shape.
async function tryP2(
  input: VideoCascadeInput,
  account: "A" | "B"
): Promise<{ ok: boolean; taskId: string | null; error: string | null; model: string }> {
  const { primaryModel, prompt, aspectRatio, imageUrls, imageMode, durationMode, userId } = input;
  try {
    let apiKeyOverride: string | undefined;
    if (account === "B") {
      const cfg = await getP2Config();
      if (!cfg.keyB) {
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
// to the product. Skipped when:
//   • multiple images already provided (intentional distinct refs)
//   • i2v / frame mode (single image is a literal first-frame seed)
//   • text mode (no images at all)
function triplicateProductRef(input: VideoCascadeInput): VideoCascadeInput {
  const imgs = input.imageUrls || [];
  if (imgs.length !== 1) return input;
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
  const startTier = Math.max(1, Math.min(2, input.startTier || 1));
  const errs: Record<number, string> = {};
  const imageCount = input.imageUrls?.length || 0;

  // ── Tier 1 — p2 / Crun, account A ──
  if (startTier <= 1) {
    const t = await tryP2(input, "A");
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

  // ── Tier 2 — p2 / Crun, account B (rate-limit / quota bypass) ──
  if (startTier <= 2) {
    const t = await tryP2(input, "B");
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

  return {
    ok: false,
    error: Object.entries(errs)
      .map(([n, e]) => `tier${n}: ${e}`)
      .join("; "),
    tierLog,
  };
}
