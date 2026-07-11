// Video cascade — slot-rotation edition.
//
// Admin configures 3 slots in /admin/settings → video_cascade_slots.
// Each task picks a starting slot via round-robin (Postgres sequence,
// atomic), walks all 3 cyclically, then re-tries the starting slot
// once more (4 attempts total). Spreads load across providers AND
// gives the preferred slot a second chance on transient first-call
// failures.
//
// Available slot providers for video:
//   p1   — GeminiGen
//   p2-a — Crun account A
//   p2-b — Crun account B
//   p5   — APIMart (Veo + Grok, $0.08/gen Veo Fast)
//
// p4 (Grsai) is IMAGE-ONLY and excluded from video slots by
// cascade-rotation.ts's sanitizeSlots() validation.
//
// `startTier` was previously used to skip create-time-OK-but-poll-failed
// tiers on retry. With slot rotation the equivalent is `skipSlot` —
// pass the slot label that previously accepted at create-time so the
// cascade tries the OTHER slots first.

import { p1CreateTask } from "@/lib/p1";
import { p2CreateTask } from "@/lib/p2";
import { p5CreateVideo } from "@/lib/p5";
import { p6CreateVideo, type P6Slot } from "@/lib/p6";
import { getP2Config } from "@/lib/settings";
import {
  getVideoMainSlots,
  getVideoFallbackSlots,
  getGrokMainSlots,
  getGrokFallbackSlots,
  getCinemaMainSlots,
  getCinemaFallbackSlots,
  getSora2MainSlots,
  getSora2FallbackSlots,
  getGeminiMainSlots,
  getGeminiFallbackSlots,
  nextMainStartIndex,
  nextFallbackStartIndex,
  slotToProvider,
  type SlotProvider,
  type CascadeAsset,
} from "@/lib/cascade-rotation";

export type VideoCascadeProvider = "p1" | "p2" | "p5" | "p6";

export type VideoCascadeInput = {
  /** Veo or Crun model name in p2/Crun format. */
  primaryModel: string;
  prompt: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
  userId?: string;
  /** Slot label (e.g. "p2-a") to AVOID this attempt. Retry path uses
   *  this to land on a different slot than the prior failed one. */
  skipSlot?: SlotProvider;
  /** When true, pick from FALLBACK slot pool (round-robin) instead
   *  of MAIN. Set by /api/history/retry + auto-resubmit cron.
   *  Default false = first fire on a main slot. */
  retry?: boolean;
  /** When true, bypass the round-robin counter and start at fallback
   *  position 0 (the FIRST configured fallback slot). Used by the
   *  admin Resubmit button per user direction: "when admin click
   *  resubmit, it starts from first fallback cascade". Combined with
   *  retry=true. No effect when retry=false. */
  forceFirstFallback?: boolean;
  /** Force this EXACT slot for this attempt, bypassing round-robin +
   *  fallback selection entirely. Set by the History → Original Video
   *  "pick provider" Resubmit: the user chose e.g. p6-b, so this fire uses
   *  p6-b. If it fails, event-driven recovery (settle.ts / cron, which do
   *  NOT set forceSlot) cascades normally — "try chosen provider first,
   *  then cascade". Takes precedence over retry/forceFirstFallback/skipSlot. */
  forceSlot?: SlotProvider;
  /** Which cascade pool to draw from. Defaults to "video" (UGC + Auto
   *  Content + Veo cinema). "grok" routes through the Grok cascade
   *  (typically p6-a..h). "cinema" routes through the Cinema (Seedance)
   *  cascade (p1 + p6). "gemini" routes through the GeminiOmni cascade
   *  (p2-a + p2-b at launch). Each asset has independent slot lists +
   *  round-robin counters in lib/cascade-rotation.ts. */
  asset?: "video" | "grok" | "cinema" | "sora2" | "gemini";
};

export type VideoCascadeTierLog = {
  tier: string;
  ok: boolean;
  error?: string;
  imageCount?: number;
};

export type VideoCascadeResult =
  | {
      ok: true;
      taskId: string;
      actualProvider: VideoCascadeProvider;
      /** Which slot key actually accepted — distinguishes p2-a vs p2-b. */
      actualSlot: SlotProvider;
      /** For p6 (multi-key), the 0-indexed key in app_settings.p6_keys
       *  that accepted this task. settle.ts uses this to poll with the
       *  same key (APIPod scopes task_ids per account). */
      keyIndex?: number;
      actualModel: string;
      fallbackUsed: boolean;
      tierLog: VideoCascadeTierLog[];
    }
  | {
      ok: false;
      error: string;
      tierLog: VideoCascadeTierLog[];
    };

async function tryVideoSlot(
  slot: SlotProvider,
  input: VideoCascadeInput
): Promise<{ ok: boolean; taskId: string | null; error: string | null; model: string; keyIndex?: number }> {
  const { primaryModel, prompt, aspectRatio, imageUrls, imageMode, durationMode, userId } = input;
  if (slot === "none") {
    return { ok: false, taskId: null, error: "slot disabled (none)", model: primaryModel };
  }
  try {
    if (slot === "p2-a" || slot === "p2-b") {
      let apiKeyOverride: string | undefined;
      if (slot === "p2-b") {
        const cfg = await getP2Config();
        if (!cfg.keyB) {
          return { ok: false, taskId: null, error: "p2_key_b not configured", model: primaryModel };
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
        forceP2: true,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    if (slot === "p5") {
      const r = await p5CreateVideo({
        prompt,
        model: primaryModel,
        aspectRatio,
        imageUrls,
        imageMode,
        durationMode,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    if (slot === "p1") {
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
    if (slot.startsWith("p6-")) {
      const r = await p6CreateVideo({
        slot: slot as P6Slot,
        prompt,
        model: primaryModel,
        aspectRatio,
        imageUrls,
        imageMode,
        durationMode,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: primaryModel,
      };
    }
    return { ok: false, taskId: null, error: `unknown slot ${slot}`, model: primaryModel };
  } catch (e: any) {
    return { ok: false, taskId: null, error: e?.message || String(e), model: primaryModel };
  }
}

// Triplication removed per product call — every model now accepts
// 1+ distinct refs natively, so duplicating the same image 3× just
// bloated the payload with zero benefit. 1 picked → 1 sent.

export async function generateVideoWithCascade(
  rawInput: VideoCascadeInput
): Promise<VideoCascadeResult> {
  const input = rawInput;
  const tierLog: VideoCascadeTierLog[] = [];
  const imageCount = input.imageUrls?.length || 0;

  // Pick the slot pool based on asset:
  //   • "video"  (default) — UGC + Auto Content + Veo (Viral talking-object)
  //   • "grok"   — legacy Grok tab + cinema route when modelChoice='grok'
  //   • "cinema" — Seedance tab
  //   • "sora2"  — Sora 2 tab + Auto Content Sora 2 provider (APIPod-only)
  // Each asset has its own main/fallback lists + independent round-robin
  // counters so admins can tune providers per-feature without one
  // tab's traffic affecting another's rotation.
  const asset: CascadeAsset = input.asset || "video";
  const getMains =
    asset === "grok"
      ? getGrokMainSlots
      : asset === "cinema"
        ? getCinemaMainSlots
        : asset === "sora2"
          ? getSora2MainSlots
          : asset === "gemini"
            ? getGeminiMainSlots
            : getVideoMainSlots;
  const getFbs =
    asset === "grok"
      ? getGrokFallbackSlots
      : asset === "cinema"
        ? getCinemaFallbackSlots
        : asset === "sora2"
          ? getSora2FallbackSlots
          : asset === "gemini"
            ? getGeminiFallbackSlots
            : getVideoFallbackSlots;

  // SINGLE-SHOT per user direction. Two modes:
  //   retry=false (initial fire): pick ONE main slot via round-robin
  //   retry=true  (resubmit / auto-cron): pick ONE fallback slot via
  //                                       independent round-robin
  const slots = input.retry ? await getFbs() : await getMains();
  let startIdx: number;
  if (input.retry && input.forceFirstFallback) {
    // Admin Resubmit: bypass round-robin and start at the FIRST non-"none"
    // fallback slot so the row gets a fresh full-cascade walk every time
    // an admin manually clicks Resubmit. Without this, repeated admin
    // clicks would keep advancing the round-robin counter and skip earlier
    // slots that may have recovered by now.
    const firstValid = slots.findIndex((s) => s !== "none");
    startIdx = firstValid >= 0 ? firstValid : 0;
  } else {
    startIdx = input.retry
      ? await nextFallbackStartIndex(asset, slots)
      : await nextMainStartIndex(asset, slots);
  }

  // skipSlot: if rotation landed on the same slot that just failed,
  // advance to the next non-none slot.
  if (input.skipSlot) {
    const validIdxs = slots
      .map((s, i) => (s === "none" ? -1 : i))
      .filter((i) => i >= 0);
    if (validIdxs.length > 1 && slots[startIdx] === input.skipSlot) {
      const pos = validIdxs.indexOf(startIdx);
      startIdx = validIdxs[(pos + 1) % validIdxs.length];
    }
  }
  // forceSlot: user explicitly picked a provider for this fire — use it
  // verbatim, ignoring the round-robin/fallback selection above.
  const order: SlotProvider[] = input.forceSlot
    ? [input.forceSlot]
    : slots[startIdx] === "none"
      ? []
      : [slots[startIdx]];

  const errs: Record<number, string> = {};
  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    const t = await tryVideoSlot(slot, input);
    tierLog.push({
      tier: `${i + 1}:${slot}:${input.primaryModel}`,
      ok: t.ok,
      error: t.error ?? undefined,
      imageCount,
    });
    if (t.ok && t.taskId) {
      const fallbackUsed = i > 0;
      if (fallbackUsed) {
        console.warn(`[video-cascade] slot ${slot} saved the row (start=${slots[startIdx]}, retry=${!!input.retry})`);
      }
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: slotToProvider(slot) as VideoCascadeProvider,
        actualSlot: slot,
        keyIndex: t.keyIndex,
        actualModel: t.model,
        fallbackUsed,
        tierLog,
      };
    }
    errs[i + 1] = t.error || "unknown";
    console.warn(`[video-cascade] slot ${slot} failed: ${t.error}`);
  }

  return {
    ok: false,
    error: Object.entries(errs)
      .map(([n, e]) => `attempt${n}: ${e}`)
      .join("; "),
    tierLog,
  };
}
