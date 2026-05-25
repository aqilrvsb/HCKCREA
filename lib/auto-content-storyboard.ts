// Storyboard helpers for the Auto Content tab's GeminiOmni 2-stage
// pipeline. Stage 1 = GPT Image 2 generates a single key-frame
// storyboard from the user's reference images + the master plan's
// storyboardPrompt. Stage 2 = GeminiOmni animates that storyboard.
//
// This module is consumed only when providerChoice === "gemini" in
// app/api/generate/auto-content/route.ts. Veo / Sora 2 paths are
// unaffected.

import { generateImageWithCascade } from "@/lib/image-cascade";
import { p2GetStatus } from "@/lib/p2";
import { p4GetStatus } from "@/lib/p4";
import { p5GetStatus } from "@/lib/p5";
import { p6GetStatus, type P6Slot } from "@/lib/p6";
import type { SlotProvider } from "@/lib/cascade-rotation";

// Per spec §1: 3 cascade-walk passes max. Each pass walks all 4 image
// slots (p2-a, p2-b, p4, p5/p6) so up to 12 provider attempts total
// before the row fails.
export const MAX_STORYBOARD_RETRIES = 3;

// Hardcoded prompt for the GeminiOmni animate step. The storyboard
// image already captures scene/composition/character/product, so the
// video prompt is a generic "animate this" instruction rather than a
// re-description that could conflict with the visual reference.
// VERBATIM per user direction — typos / spacing preserved intentionally.
export const GEMINI_VIDEO_PROMPT =
  "make a seamless video UGC style using storyboard I've upload. maintain the exact visual style, characters , shape and colours. smooth motion. realistic video style with audio and dialoge";

// Product-framework variant of the GeminiOmni animate-step prompt.
// Used when the master plan picks a "product" framework (Product Hero,
// USP Showcase, Flat Lay, etc.) — these have no character on screen
// so "product" wording fits better than "characters".
// VERBATIM per user direction — typos / spacing preserved (note the
// double space before the comma after "product").
export const GEMINI_VIDEO_PROMPT_PRODUCT =
  "make a seamless video product style using storyboard I've upload. maintain the exact visual style, product  , shape and colours. smooth motion. realistic video style with audio and dialoge";

// Pick the right Gemini video prompt based on the framework's type.
// Defaults to the UGC variant for ugc + lifestyle frameworks (both
// typically have a person in frame). Only "product" frameworks (no
// character) get the product variant. Pass meta.framework_type from
// history rows or item.frameworkType from in-flight plans.
export function pickGeminiVideoPrompt(frameworkType?: string | null): string {
  return frameworkType === "product"
    ? GEMINI_VIDEO_PROMPT_PRODUCT
    : GEMINI_VIDEO_PROMPT;
}

// Strip the "Spoken dialog:" timing block + any trailing whitespace from
// a videoPromptShot1 string. Mirrors the regex used by extractDialogBlock
// in app/api/generate/auto-content/route.ts so the storyboard prompt is
// pure visual description, no audio/dialog markers.
function stripDialogBlock(prompt: string): string {
  return prompt
    .replace(/\n*spoken\s+dialog[:\s][\s\S]*$/i, "")
    .replace(/\n*dialog[:\s][\s\S]*$/i, "")
    .trim();
}

// Fallback storyboard prompt builder — used when the master plan LLM
// omits the storyboardPrompt field. Derives one mechanically from the
// videoPromptShot1 (the existing scene description), stripping dialog
// + prepending a static-frame prefix so GPT Image 2 treats it as a
// composition prompt, not a motion description.
export function buildStoryboardFallback(plan: {
  videoPromptShot1?: string;
  framework?: string;
}): string {
  const sceneText = stripDialogBlock(String(plan.videoPromptShot1 || ""));
  const prefix = "Photoreal first-frame storyboard. ";
  const suffix =
    ", photoreal cinematic 85mm lens, soft natural lighting, vertical 9:16 composition.";
  // Cap at ~600 chars (GPT Image 2 sweet spot — long prompts dilute
  // composition fidelity).
  const body = sceneText.substring(0, 600 - prefix.length - suffix.length);
  return prefix + body + suffix;
}

// Result type for a single storyboard pass.
export type StoryboardCascadeResult =
  | {
      ok: true;
      taskId: string;
      slot: SlotProvider;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      tierLogs: Array<{ pass: number; tierLog: any[] }>;
    };

// Run the image cascade up to MAX_STORYBOARD_RETRIES times. Each pass
// uses fullCascade=true so it walks all main + fallback slots. We retry
// the whole cascade if the entire walk fails — covers transient
// platform-wide outages that resolve within seconds.
export async function runStoryboardCascadeWithRetry(input: {
  prompt: string;
  aspectRatio: string;
  imageUrls: string[];
}): Promise<StoryboardCascadeResult> {
  const tierLogs: Array<{ pass: number; tierLog: any[] }> = [];
  let lastError = "Storyboard cascade not attempted";

  for (let attempt = 1; attempt <= MAX_STORYBOARD_RETRIES; attempt++) {
    const r = await generateImageWithCascade({
      primaryModel: "gpt-image-2",
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      imageUrls: input.imageUrls,
      fullCascade: true,
    });
    if (r.ok) {
      return {
        ok: true,
        taskId: r.taskId,
        slot: r.actualSlot,
        attempts: attempt,
      };
    }
    tierLogs.push({ pass: attempt, tierLog: r.tierLog });
    lastError = r.error;
    // Short pause between full-cascade passes — gives transient outages
    // time to clear. 2s × 2 retries = max 4s extra latency on full fail.
    if (attempt < MAX_STORYBOARD_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return {
    ok: false,
    error: `Storyboard cascade failed after ${MAX_STORYBOARD_RETRIES} passes: ${lastError}`,
    attempts: MAX_STORYBOARD_RETRIES,
    tierLogs,
  };
}

// Poll an image task to completion. Dispatches to the right adapter
// based on the slot label that accepted the task. Returns the final
// outputUrl or null on failure / timeout.
//
// Default 60s timeout — GPT Image 2 typically completes in 15-30s on
// p2/p4/p5, slightly longer on p6. 60s gives 2× headroom without
// blocking the route past the 300s maxDuration budget.
export async function pollImageTaskUntilDone(input: {
  taskId: string;
  slot: SlotProvider;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<{ ok: true; outputUrl: string } | { ok: false; error: string }> {
  const maxWaitMs = input.maxWaitMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    let status: { status: string; outputUrl?: string; error?: string };
    try {
      if (input.slot === "p2-a" || input.slot === "p2-b") {
        const r = await p2GetStatus(input.taskId, "p2");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p4") {
        const r = await p4GetStatus(input.taskId);
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p5") {
        const r = await p5GetStatus(input.taskId);
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot.startsWith("p6-")) {
        const r = await p6GetStatus(input.taskId, input.slot as P6Slot, "image");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p1") {
        // p1 (GeminiGen) — p2GetStatus dispatches to p1 when provider="p1".
        const r = await p2GetStatus(input.taskId, "p1");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else {
        return { ok: false, error: `Unknown slot ${input.slot} for polling` };
      }
    } catch (e: any) {
      return { ok: false, error: `Poll exception: ${e?.message || String(e)}` };
    }

    if (status.status === "succeeded" && status.outputUrl) {
      return { ok: true, outputUrl: status.outputUrl };
    }
    if (status.status === "failed") {
      return { ok: false, error: status.error || "Image task reported failed" };
    }
    // pending / running — keep polling
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { ok: false, error: `Storyboard poll timeout after ${maxWaitMs}ms` };
}
