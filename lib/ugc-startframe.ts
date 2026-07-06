// Auto UGC start-frame generator — SYNCHRONOUS Banana Pro 2 (nano-banana-pro)
// image compose used by /api/generate/auto-ugc.
//
// Each Grok-Imagine segment needs a start frame BEFORE it can fire (i2v).
// This composes the avatar (create-criteria persona or an uploaded avatar
// photo) together with the product image(s) into a single scene image, then
// returns that image's URL so the caller can feed it to Grok as the first
// frame.
//
// It walks the admin IMAGE cascade (Main → Fallback, same order as
// refine-frame + generateImageWithCascade) and polls each tier until the
// provider returns an explicit succeeded/failed. On timeout (no explicit
// failure) it STOPS the cascade rather than firing the next tier — the task
// may still complete upstream and re-firing would waste a slot. This mirrors
// lib/refine-frame.ts's double-bill-safe behaviour.
//
// No userId is threaded to any provider call — the start frame is internal
// infrastructure bundled into the Grok clip's price, never separately billed.

import { p1CreateTask, p1GetStatus } from "@/lib/p1";
import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { p4CreateImage, p4GetStatus } from "@/lib/p4";
import { p5CreateImage, p5GetStatus } from "@/lib/p5";
import { p6CreateImage, p6GetStatus, type P6Slot } from "@/lib/p6";
import {
  getImageMainSlots,
  getImageFallbackSlots,
  type SlotProvider,
} from "@/lib/cascade-rotation";
import { getP2Config } from "@/lib/settings";

type Provider = SlotProvider | "p2";

export type StartFrameOpts = {
  prompt: string;
  /** Reference images — avatar first, then product image(s). */
  imageUrls: string[];
  aspectRatio?: string;
  perTierTimeoutMs?: number;
};

export type StartFrameResult =
  | { ok: true; url: string; provider: Provider; tierLog: string[] }
  | { ok: false; error: string; tierLog: string[] };

type TierResult =
  | { ok: true; url: string }
  | { ok: false; error: string; failedExplicitly: boolean };

const MODEL = "nano-banana-pro";

async function tryOn(provider: Provider, opts: StartFrameOpts): Promise<TierResult> {
  const aspect = opts.aspectRatio || "9:16";
  const imageUrls = opts.imageUrls.filter((u) => typeof u === "string" && !!u);
  const timeoutMs = opts.perTierTimeoutMs ?? 120_000;

  let taskId: string | null = null;
  let createError: string | null = null;
  try {
    if (provider === "p2" || provider === "p2-a" || provider === "p2-b") {
      let apiKeyOverride: string | undefined;
      let skip = false;
      if (provider === "p2-b") {
        const cfg = await getP2Config();
        if (!cfg.keyB) {
          createError = "p2_key_b not configured";
          skip = true;
        } else apiKeyOverride = cfg.keyB;
      }
      if (!skip) {
        const r = await p2CreateTask({
          model: "google/nano-banana-pro",
          prompt: opts.prompt,
          imageUrls,
          aspectRatio: aspect,
          apiKeyOverride,
        });
        taskId = r.ok ? (r.task_id ?? null) : null;
        createError = r.ok ? null : (r.error ?? null);
      }
    } else if (provider === "p1") {
      const r = await p1CreateTask({
        model: MODEL,
        prompt: opts.prompt,
        imageUrls,
        aspectRatio: aspect,
        resolution: "2K",
      });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    } else if (provider === "p4") {
      const r = await p4CreateImage({ model: MODEL, prompt: opts.prompt, imageUrls, aspectRatio: aspect });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    } else if (provider === "p5") {
      const r = await p5CreateImage({ model: MODEL, prompt: opts.prompt, imageUrls, aspectRatio: aspect });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    } else if (provider.startsWith("p6-")) {
      const r = await p6CreateImage({
        slot: provider as P6Slot,
        model: MODEL,
        prompt: opts.prompt,
        imageUrls,
        aspectRatio: aspect,
      });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    }
  } catch (e: any) {
    createError = e?.message || String(e);
  }

  if (!taskId) {
    return { ok: false, error: `${provider} create failed: ${createError || "unknown"}`, failedExplicitly: true };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      let status: "running" | "succeeded" | "failed" | "pending" = "pending";
      let outputUrl: string | undefined;
      let pollError: string | undefined;
      if (provider === "p2" || provider === "p2-a" || provider === "p2-b") {
        const s = await p2GetStatus(taskId, "p2");
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else if (provider === "p1") {
        const s = await p1GetStatus(taskId);
        status = s.status;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else if (provider === "p4") {
        const s = await p4GetStatus(taskId);
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else if (provider === "p5") {
        const s = await p5GetStatus(taskId);
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else if (provider.startsWith("p6-")) {
        const s = await p6GetStatus(taskId, provider as P6Slot, "image");
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      }
      if (status === "succeeded" && outputUrl) return { ok: true, url: outputUrl };
      if (status === "failed") {
        return { ok: false, error: `${provider} task failed: ${pollError || "unknown"}`, failedExplicitly: true };
      }
    } catch (e: any) {
      console.warn(`[ugc-startframe] ${provider} poll error:`, e?.message);
    }
  }
  // Timed out without an explicit failure — do NOT advance (task may still
  // land upstream). Treat as non-explicit so the cascade stops.
  return { ok: false, error: `${provider} still pending after ${timeoutMs}ms`, failedExplicitly: false };
}

export async function generateUgcStartFrame(opts: StartFrameOpts): Promise<StartFrameResult> {
  const tierLog: string[] = [];
  if (!opts.prompt) return { ok: false, error: "Missing prompt", tierLog };
  if (!opts.imageUrls?.some((u) => !!u)) return { ok: false, error: "Missing reference images", tierLog };

  const [mainSlots, fallbackSlots] = await Promise.all([getImageMainSlots(), getImageFallbackSlots()]);
  const cascade: Provider[] = [];
  for (const s of [...mainSlots, ...fallbackSlots]) {
    if (s === "none") continue;
    cascade.push(s as Provider);
  }
  if (cascade.length === 0) return { ok: false, error: "No image cascade configured", tierLog };

  for (const provider of cascade) {
    const r = await tryOn(provider, opts);
    tierLog.push(`${provider}:${r.ok ? "ok" : r.failedExplicitly ? "fail" : "pending"}${r.ok ? "" : ` (${r.error})`}`);
    if (r.ok) return { ok: true, url: r.url, provider, tierLog };
    if (!r.failedExplicitly) {
      // Pending upstream — stop to avoid burning another slot on a task
      // that may still complete.
      return { ok: false, error: r.error, tierLog };
    }
  }
  return { ok: false, error: "All start-frame tiers failed", tierLog };
}
