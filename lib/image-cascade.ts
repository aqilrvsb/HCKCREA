// Image cascade — slot-rotation edition.
//
// Admin configures 3 slots in /admin/settings → image_cascade_slots.
// Each task picks a starting slot via round-robin (Postgres sequence,
// atomic), then walks all 3 cyclically until one succeeds or all fail.
//
// Available slot providers for images:
//   p1   — GeminiGen (Google direct)
//   p2-a — Crun account A
//   p2-b — Crun account B
//   p4   — Grsai (cheapest Banana Pro at 2K)
//   p5   — APIMart (cross-vendor resilience)
//
// Caller-facing API unchanged: generateImageWithCascade({primaryProvider, primaryModel, ...}).
// `primaryProvider` is now IGNORED — the slot rotation decides routing.
// We keep the param for backwards compatibility with all existing
// callers (image route, viral, fairytale, settle.ts, retry route).

import { p1CreateTask } from "@/lib/p1";
import { p2CreateTask } from "@/lib/p2";
import { p3CreateImage } from "@/lib/p3";
import { p4CreateImage } from "@/lib/p4";
import { p5CreateImage } from "@/lib/p5";
import { getP2Config } from "@/lib/settings";
import {
  getImageSlots,
  nextStartSlot,
  walkOrder,
  slotToProvider,
  type SlotProvider,
} from "@/lib/cascade-rotation";

export type CascadeProvider = "p1" | "p2" | "p3" | "p4" | "p5";

export type CascadeInput = {
  /** Kept for backwards compatibility. Slot rotation ignores this. */
  primaryProvider?: "p2" | "p3" | "p4" | "p5";
  /** Bare model key (e.g. "nano-banana-pro", "gpt-image-2"). */
  primaryModel: string;
  /** Optional explicit p2 model id (e.g. "google/nano-banana-pro"). */
  primaryModelP2?: string;
  prompt: string;
  aspectRatio?: string;
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
      /** Which provider polls the task. p2-a + p2-b both poll as "p2". */
      actualProvider: CascadeProvider;
      /** Which slot key actually accepted the task — distinguishes
       *  p2-a vs p2-b for the UI chip ("P2-A" / "P2-B"). */
      actualSlot: SlotProvider;
      actualModel: string;
      /** True iff a non-starting slot saved the row. */
      fallbackUsed: boolean;
      tierLog: CascadeTierLog[];
    }
  | {
      ok: false;
      error: string;
      tierLog: CascadeTierLog[];
    };

function toP2Model(bareModel: string, hint?: string): string {
  if (hint && !hint.toLowerCase().includes("nano-banana-fast")) return hint;
  const m = bareModel.toLowerCase();
  if (m === "nano-banana-pro") return "google/nano-banana-pro";
  if (m === "nano-banana-2") return "google/nano-banana-2";
  if (m === "nano-banana-v2") return "google/nano-banana-v2";
  // p2 (Crun) has no -fast variant. Fall back to plain nano-banana
  // so the cascade slot still succeeds instead of returning
  // "Missing Params or Type Error".
  if (m === "nano-banana-fast") return "google/nano-banana";
  if (m === "nano-banana") return "google/nano-banana";
  if (m.includes("gpt-image")) return "openai/gpt-image-2-stable";
  return bareModel;
}

async function tryImageSlot(
  slot: SlotProvider,
  bareModel: string,
  prompt: string,
  aspectRatio?: string,
  imageUrls?: string[]
): Promise<{ ok: boolean; taskId: string | null; error: string | null; model: string }> {
  if (slot === "none") {
    return { ok: false, taskId: null, error: "slot disabled (none)", model: bareModel };
  }
  try {
    if (slot === "p2-a" || slot === "p2-b") {
      let apiKeyOverride: string | undefined;
      if (slot === "p2-b") {
        const cfg = await getP2Config();
        if (!cfg.keyB) {
          return { ok: false, taskId: null, error: "p2_key_b not configured", model: bareModel };
        }
        apiKeyOverride = cfg.keyB;
      }
      const model = toP2Model(bareModel);
      const r = await p2CreateTask({
        model,
        prompt,
        imageUrls,
        aspectRatio,
        apiKeyOverride,
      });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model,
      };
    }
    if (slot === "p4") {
      const r = await p4CreateImage({ prompt, model: bareModel, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: bareModel,
      };
    }
    if (slot === "p5") {
      const r = await p5CreateImage({ prompt, model: bareModel, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.ok ? (r.task_id ?? null) : null,
        error: r.ok ? null : (r.error ?? null),
        model: bareModel,
      };
    }
    if (slot === "p1") {
      const r = await p1CreateTask({ model: bareModel, prompt, aspectRatio, imageUrls });
      return {
        ok: r.ok,
        taskId: r.task_id ?? null,
        error: r.ok ? null : (r.error ?? null),
        model: bareModel,
      };
    }
    return { ok: false, taskId: null, error: `unknown slot ${slot}`, model: bareModel };
  } catch (e: any) {
    return { ok: false, taskId: null, error: e?.message || String(e), model: bareModel };
  }
}

export async function generateImageWithCascade(
  input: CascadeInput
): Promise<CascadeResult> {
  const tierLog: CascadeTierLog[] = [];
  const { primaryModel, prompt, aspectRatio, imageUrls } = input;
  const bare = primaryModel.replace(/^google\//, "").replace(/^openai\//, "");

  const slots = await getImageSlots();
  const startIdx = await nextStartSlot("image");
  const order = walkOrder(slots, startIdx);

  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    const t = await tryImageSlot(slot, bare, prompt, aspectRatio, imageUrls);
    tierLog.push({
      tier: `${i + 1}:${slot}:${t.model}`,
      ok: t.ok,
      error: t.error ?? undefined,
    });
    if (t.ok && t.taskId) {
      const fallbackUsed = i > 0;
      if (fallbackUsed) {
        console.warn(`[image-cascade] slot ${slot} saved the row (start=${slots[startIdx]})`);
      }
      return {
        ok: true,
        taskId: t.taskId,
        actualProvider: slotToProvider(slot) as CascadeProvider,
        actualSlot: slot,
        actualModel: t.model,
        fallbackUsed,
        tierLog,
      };
    }
    console.warn(`[image-cascade] slot ${slot} failed: ${t.error}`);
  }

  return {
    ok: false,
    error: tierLog.map((t) => `${t.tier}: ${t.error}`).join("; "),
    tierLog,
  };
}
