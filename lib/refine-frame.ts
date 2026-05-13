// Refine an extracted seg-1 frame using Nano Banana Pro so the product
// in the frame matches the user's attached product image pixel-perfectly
// before Veo r2v conditions on it for seg-2.
//
// Why this exists: Veo r2v's image conditioning is *soft* — it draws
// "something that looks like the reference" each frame, so subtle
// product blur creeps in over the 8s clip. By front-loading a sharp
// product onto the start frame itself, seg-2 baselines off a clean
// anchor and the drift is much less visible.
//
// Pipeline:
//   1. POST p1 (Nano Banana Pro) with [frame, product] + a tight prompt
//   2. Poll p1GetStatus every 2s up to 60s
//   3. Return the refined image URL on success, or null on timeout/fail
//      so callers can fall back to the original frame.
//
// Synchronous from the caller's perspective — slots into the extend
// after() background hook between frame-resolve and Veo-fire.

import { p1CreateTask, p1GetStatus } from "@/lib/p1";

const REFINE_PROMPT = [
  "Replace the product visible in the FIRST image with the product from the SECOND image.",
  "Keep everything else from the FIRST image pixel-identical: person, pose, face, expression, hair, clothing, hands, background, lighting, camera framing, blur, depth of field.",
  "The product must match the SECOND image exactly — same label, same typography, same color, same shape, same packaging, same logo, same size. Sharp focus on the label, no warping, no recoloring, no text drift.",
  "The result should look like the original FIRST image was simply re-shot with the correct product in the hand. Do not move the product or change its position in the frame — only its appearance.",
  "Output a single photorealistic image at the same aspect ratio as the FIRST image.",
].join(" ");

export async function refineFrameWithProduct(opts: {
  frameUrl: string;
  productUrl: string;
  aspectRatio?: string;
  timeoutMs?: number;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!opts.frameUrl) return { ok: false, error: "Missing frameUrl" };
  if (!opts.productUrl) return { ok: false, error: "Missing productUrl" };

  // Submit the edit task. Order matters — frame FIRST, product SECOND
  // matches the prompt wording above.
  const created = await p1CreateTask({
    model: "nano-banana-pro",
    prompt: REFINE_PROMPT,
    imageUrls: [opts.frameUrl, opts.productUrl],
    aspectRatio: opts.aspectRatio || "9:16",
    resolution: "2K",
  });
  if (!created.ok || !created.task_id) {
    return { ok: false, error: created.error || "p1 create failed" };
  }

  // Poll for completion. Nano Banana Pro is typically ~15-30s. Cap at
  // 60s by default — beyond that we'd rather fall back than make the
  // whole extend wait further.
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await p1GetStatus(created.task_id);
    if (status.status === "succeeded" && status.outputUrl) {
      return { ok: true, url: status.outputUrl };
    }
    if (status.status === "failed") {
      return { ok: false, error: status.error || "p1 refine failed" };
    }
    // "running" / "pending" — keep polling.
  }
  return { ok: false, error: "Refine timed out (60s)" };
}
