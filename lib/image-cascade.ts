// 3-tier fallback cascade for image generation.
//
// Used by every image-generation route (main Image tab, storytelling
// scene images, Viral Talking Object image step) so a content-block or
// transient outage on one provider doesn't kill the row.
//
// Flow (regardless of primary provider):
//   Tier 1: user's chosen primary (p2 or p3) with primary model
//   Tier 2: p1 with nano-banana-2 (fixed safe default, ALWAYS retried)
//   Tier 3: the OTHER non-p1 provider with the primary's model name
//
// If all 3 tiers fail, returns { ok: false } with a combined error
// string and the per-tier log. Caller marks the row failed; no further
// retries.
//
// Reasons each tier exists:
//   • p1 (GeminiGen) has the most lenient content filter + most reliable
//     uptime — best safety net.
//   • Tier 3 covers the case where p1 is also down (rare) by trying the
//     opposite of the user's primary, keeping their requested model
//     name for visual consistency where possible.

import { p1CreateTask } from "@/lib/p1";
import { p2CreateTask } from "@/lib/p2";
import { p3CreateImage } from "@/lib/p3";

export type CascadeProvider = "p1" | "p2" | "p3";

export type CascadeInput = {
  /** User's chosen primary provider — "p2" or "p3". Not "p1" because p1
   *  is reserved as the always-on safety-net tier. */
  primaryProvider: "p2" | "p3";
  /** Bare model key (e.g. "nano-banana-pro", "nano-banana-fast",
   *  "nano-banana-v2", "imagen-4"). Passed through to the chosen tier
   *  with provider-specific prefixing (p2 expects "google/" prefix). */
  primaryModel: string;
  /** Optional: explicit p2 model id (e.g. "google/nano-banana-pro") to
   *  use when the primary is p2. Falls back to deriving from primaryModel
   *  if not provided. */
  primaryModelP2?: string;
  prompt: string;
  aspectRatio?: string;
  /** Reference images for img2img / edit mode. */
  imageUrls?: string[];
};

export type CascadeTierLog = {
  tier: string;
  ok: boolean;
  error?: string;
};

export type CascadeResult =
  | {
      ok: true;
      taskId: string;
      /** Which provider actually accepted the task — what settle.ts
       *  needs to poll. */
      actualProvider: CascadeProvider;
      /** Which model the accepting tier was called with. */
      actualModel: string;
      /** True iff tier 2 or 3 saved the row. */
      fallbackUsed: boolean;
      tierLog: CascadeTierLog[];
    }
  | {
      ok: false;
      error: string;
      tierLog: CascadeTierLog[];
    };

// p2 model normalisation — Crun expects google/-prefixed nano-banana
// variants. Other model families pass through unchanged.
function toP2Model(bareModel: string, hint?: string): string {
  if (hint) return hint;
  const m = bareModel.toLowerCase();
  if (m === "nano-banana-pro") return "google/nano-banana-pro";
  if (m === "nano-banana-2") return "google/nano-banana-2";
  if (m === "nano-banana-v2") return "google/nano-banana-v2";
  if (m === "nano-banana-fast") return "google/nano-banana-fast";
  if (m.includes("gpt-image")) return "openai/gpt-image-2-stable";
  return bareModel;
}

async function tryProvider(
  which: CascadeProvider,
  model: string,
  prompt: string,
  aspectRatio?: string,
  imageUrls?: string[]
): Promise<{ ok: boolean; taskId: string | null; error: string | null }> {
  try {
    if (which === "p1") {
      const r = await p1CreateTask({ model, prompt, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.task_id ?? null,
        error: r.ok ? null : (r.error ?? null),
      };
    }
    if (which === "p2") {
      const r = await p2CreateTask({ model, prompt, imageUrls, aspectRatio });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
      };
    }
    // p3 — Mountsea wraps Google nano-banana with bare model names.
    const r = await p3CreateImage({ model, prompt, aspectRatio, imageUrls });
    return {
      ok: r.ok,
      taskId: r.ok ? (r.task_id ?? null) : null,
      error: r.ok ? null : (r.error ?? null),
    };
  } catch (e: any) {
    return { ok: false, taskId: null, error: e?.message || String(e) };
  }
}

export async function generateImageWithCascade(
  input: CascadeInput
): Promise<CascadeResult> {
  const tierLog: CascadeTierLog[] = [];
  const { primaryProvider, primaryModel, prompt, aspectRatio, imageUrls } = input;
  const primaryModelForP2 = toP2Model(primaryModel, input.primaryModelP2);

  // ── Tier 1: primary provider with primary model ──
  const tier1Model = primaryProvider === "p2" ? primaryModelForP2 : primaryModel;
  const t1 = await tryProvider(primaryProvider, tier1Model, prompt, aspectRatio, imageUrls);
  tierLog.push({
    tier: `1:${primaryProvider}:${tier1Model}`,
    ok: t1.ok,
    error: t1.error ?? undefined,
  });
  if (t1.ok && t1.taskId) {
    return {
      ok: true,
      taskId: t1.taskId,
      actualProvider: primaryProvider,
      actualModel: tier1Model,
      fallbackUsed: false,
      tierLog,
    };
  }
  console.warn(
    `[image-cascade] tier1 (${primaryProvider}/${tier1Model}) failed: ${t1.error}`
  );

  // ── Tier 2: p1 with nano-banana-2 (always-on safety net) ──
  const t2 = await tryProvider("p1", "nano-banana-2", prompt, aspectRatio, imageUrls);
  tierLog.push({
    tier: "2:p1:nano-banana-2",
    ok: t2.ok,
    error: t2.error ?? undefined,
  });
  if (t2.ok && t2.taskId) {
    console.warn(`[image-cascade] tier2 (p1/nano-banana-2) saved the row`);
    return {
      ok: true,
      taskId: t2.taskId,
      actualProvider: "p1",
      actualModel: "nano-banana-2",
      fallbackUsed: true,
      tierLog,
    };
  }
  console.warn(`[image-cascade] tier2 (p1/nano-banana-2) failed: ${t2.error}`);

  // ── Tier 3: the OTHER non-p1 provider with primary's model ──
  const otherProvider: "p2" | "p3" = primaryProvider === "p2" ? "p3" : "p2";
  const tier3Model = otherProvider === "p2" ? primaryModelForP2 : primaryModel;
  const t3 = await tryProvider(otherProvider, tier3Model, prompt, aspectRatio, imageUrls);
  tierLog.push({
    tier: `3:${otherProvider}:${tier3Model}`,
    ok: t3.ok,
    error: t3.error ?? undefined,
  });
  if (t3.ok && t3.taskId) {
    console.warn(
      `[image-cascade] tier3 (${otherProvider}/${tier3Model}) saved the row`
    );
    return {
      ok: true,
      taskId: t3.taskId,
      actualProvider: otherProvider,
      actualModel: tier3Model,
      fallbackUsed: true,
      tierLog,
    };
  }

  // All 3 tiers failed — caller marks row failed, no further retries.
  return {
    ok: false,
    error: `tier1(${primaryProvider}): ${t1.error}; tier2(p1): ${t2.error}; tier3(${otherProvider}): ${t3.error}`,
    tierLog,
  };
}
