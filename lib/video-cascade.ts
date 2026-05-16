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
  nextMainStartIndex,
  walkOrder,
  slotToProvider,
  type SlotProvider,
} from "@/lib/cascade-rotation";

export type VideoCascadeProvider = "p1" | "p2" | "p5" | "p6";

export type VideoCascadeInput = {
  /** Veo or Grok model name in p2/Crun format. */
  primaryModel: string;
  prompt: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
  userId?: string;
  /** Slot label (e.g. "p2-a") that previously accepted at create-time
   *  but failed during polling. Retry path uses this to push the walk
   *  to other slots first. */
  skipSlot?: SlotProvider;
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

// Product-reference triplicate (unchanged from pre-rotation): single
// image + r2v / ingredient mode → copy it 3× for tighter product anchor.
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
  const imageCount = input.imageUrls?.length || 0;

  // Walk: round-robin main → all remaining mains (wrap) → fallbacks
  // in order. Per user direction this gives every task up to 20
  // attempts (configurable via admin counts) before failing.
  const [mainSlots, fallbackSlots] = await Promise.all([
    getVideoMainSlots(),
    getVideoFallbackSlots(),
  ]);
  let startIdx = await nextMainStartIndex("video", mainSlots);

  // If admin requested skipSlot (retry path), advance the starting
  // index past it so the retry doesn't immediately hit the same slot.
  if (input.skipSlot) {
    const validIdxs = mainSlots
      .map((s, i) => (s === "none" ? -1 : i))
      .filter((i) => i >= 0);
    if (validIdxs.length > 1 && mainSlots[startIdx] === input.skipSlot) {
      const pos = validIdxs.indexOf(startIdx);
      startIdx = validIdxs[(pos + 1) % validIdxs.length];
    }
  }

  let order = walkOrder(mainSlots, fallbackSlots, startIdx);
  if (input.skipSlot) {
    // Demote skipSlot to the end of the walk (don't drop entirely —
    // user may want it as last-resort attempt).
    const without = order.filter((s) => s !== input.skipSlot);
    const onlySkipped = order.filter((s) => s === input.skipSlot);
    order = [...without, ...onlySkipped];
  }

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
        console.warn(`[video-cascade] slot ${slot} saved the row (start=${mainSlots[startIdx]})`);
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
