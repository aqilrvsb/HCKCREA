// Image-generation fallback cascade with bidirectional p2 ↔ p4 partnering.
//
// Tier 1: user's chosen primary (p2 | p3 | p4) with primary model
// Tier 2: bidirectional partner — p2 ↔ p4 (or p2 fallback for p3 primary).
//         Same model name if the partner supports it; otherwise mapped
//         to the partner's nearest equivalent (e.g. p4 nano-banana-fast
//         → p2 nano-banana since p2 has no -fast variant).
//
// p1 (GeminiGen) and the old 3-tier scheme are removed: the user wants
// images to live or die on the p2/p4 pair so the bill stays predictable
// and the cascade doesn't silently spend on a third backend.
//
// Reasons each provider exists in this cascade:
//   • p2 (Crun) — original Nano Banana host, large model selection
//   • p4 (Grsai) — ~3× cheaper Banana Pro at 2K + exclusive
//     nano-banana-fast for high-volume Storytelling batches
//   • p3 (Mountsea) — kept as opt-in primary for legacy rows; falls
//     back to p2 when picked because Mountsea has no symmetric partner

import { p2CreateTask } from "@/lib/p2";
import { p3CreateImage } from "@/lib/p3";
import { p4CreateImage } from "@/lib/p4";

export type CascadeProvider = "p1" | "p2" | "p3" | "p4";

export type CascadeInput = {
  /** User's chosen primary provider — "p2", "p3", or "p4". */
  primaryProvider: "p2" | "p3" | "p4";
  /** Bare model key (e.g. "nano-banana-pro", "nano-banana-fast",
   *  "nano-banana-2", "gpt-image-2"). Passed through to the chosen tier
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
      /** True iff the partner tier saved the row. */
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
  if (m === "nano-banana") return "google/nano-banana";
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
    if (which === "p2") {
      const r = await p2CreateTask({ model, prompt, imageUrls, aspectRatio });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
      };
    }
    if (which === "p3") {
      const r = await p3CreateImage({ model, prompt, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
      };
    }
    if (which === "p4") {
      const r = await p4CreateImage({ model, prompt, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
      };
    }
    // p1 is no longer a cascade tier for images. Reject if somehow reached.
    return { ok: false, taskId: null, error: "p1 not supported in image cascade" };
  } catch (e: any) {
    return { ok: false, taskId: null, error: e?.message || String(e) };
  }
}

// Bidirectional partner picker:
//   p2 → p4 (cheaper Banana, exclusive nano-banana-fast)
//   p4 → p2 (Grsai outage → Crun's well-tested Banana host)
//   p3 → p2 (Mountsea is solo; p2 is the safest generic fallback)
function partnerOf(primary: "p2" | "p3" | "p4"): "p2" | "p4" {
  if (primary === "p2") return "p4";
  if (primary === "p4") return "p2";
  return "p2"; // p3 → p2
}

// Map a primary's model to the partner's nearest supported equivalent.
// Special case: p4's nano-banana-fast has no p2 equivalent — fall back
// to p2's regular nano-banana so Storytelling scenes still render even
// if Grsai is down. Other models keep their name (p2 + p4 share the
// nano-banana-* family naming; p2 needs the "google/" prefix added).
function partnerModel(primaryModel: string, partner: "p2" | "p4"): string {
  const m = primaryModel.toLowerCase().replace(/^google\//, "").replace(/^openai\//, "");
  if (partner === "p2") {
    if (m === "nano-banana-fast") return "google/nano-banana";
    return toP2Model(m);
  }
  // partner === "p4" — Grsai uses bare names, no prefix
  if (m === "nano-banana-pro" || m === "nano-banana-2" || m === "nano-banana-fast" || m === "nano-banana") {
    return m;
  }
  if (m.includes("gpt-image")) return "gpt-image-2";
  return m;
}

export async function generateImageWithCascade(
  input: CascadeInput
): Promise<CascadeResult> {
  const tierLog: CascadeTierLog[] = [];
  const { primaryProvider, primaryModel, prompt, aspectRatio, imageUrls } = input;

  // ── Tier 1: primary provider with primary model ──
  const tier1Model =
    primaryProvider === "p2"
      ? toP2Model(primaryModel, input.primaryModelP2)
      : primaryModel;
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

  // ── Tier 2: bidirectional partner ──
  const partner = partnerOf(primaryProvider);
  const tier2Model = partnerModel(primaryModel, partner);
  const t2 = await tryProvider(partner, tier2Model, prompt, aspectRatio, imageUrls);
  tierLog.push({
    tier: `2:${partner}:${tier2Model}`,
    ok: t2.ok,
    error: t2.error ?? undefined,
  });
  if (t2.ok && t2.taskId) {
    console.warn(`[image-cascade] tier2 (${partner}/${tier2Model}) saved the row`);
    return {
      ok: true,
      taskId: t2.taskId,
      actualProvider: partner,
      actualModel: tier2Model,
      fallbackUsed: true,
      tierLog,
    };
  }

  return {
    ok: false,
    error: `tier1(${primaryProvider}): ${t1.error}; tier2(${partner}): ${t2.error}`,
    tierLog,
  };
}
