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
// Cascade: p2 → p1 → p3 (same order as the video cascade). Each tier
// submits a Nano Banana Pro edit task and polls until done. If one
// tier times out or errors, the next tier picks up. If all three fail
// the caller falls back to the original (unrefined) frame so the
// extend pipeline never blocks.

import { p1CreateTask, p1GetStatus } from "@/lib/p1";
import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { p3CreateImage, p3GetStatus } from "@/lib/p3";

const REFINE_PROMPT = [
  "Replace the product visible in the FIRST image with the product from the SECOND image.",
  "Keep everything else from the FIRST image pixel-identical: person, pose, face, expression, hair, clothing, hands, background, lighting, camera framing, blur, depth of field.",
  "The product must match the SECOND image exactly — same label, same typography, same color, same shape, same packaging, same logo, same size. Sharp focus on the label, no warping, no recoloring, no text drift.",
  "The result should look like the original FIRST image was simply re-shot with the correct product in the hand. Do not move the product or change its position in the frame — only its appearance.",
  "Output a single photorealistic image at the same aspect ratio as the FIRST image.",
].join(" ");

type RefineResult = { ok: true; url: string } | { ok: false; error: string };
type Provider = "p1" | "p2" | "p3";

type RefineOpts = {
  frameUrl: string;
  productUrl: string;
  aspectRatio?: string;
  /** Total ceiling per tier — beyond this we drop to the next tier. */
  perTierTimeoutMs?: number;
};

// Submit + poll on one provider. Returns the refined image URL or an
// error. Each provider has its own create + status endpoints; we wrap
// them in a uniform shape here so the cascade loop stays readable.
async function tryRefineOn(
  provider: Provider,
  opts: RefineOpts
): Promise<RefineResult> {
  const aspect = opts.aspectRatio || "9:16";
  const imageUrls = [opts.frameUrl, opts.productUrl];
  const timeoutMs = opts.perTierTimeoutMs ?? 60_000;

  // 1. Create.
  let taskId: string | null = null;
  let createError: string | null = null;
  try {
    if (provider === "p2") {
      const r = await p2CreateTask({
        model: "google/nano-banana-pro",
        prompt: REFINE_PROMPT,
        imageUrls,
        aspectRatio: aspect,
      });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    } else if (provider === "p1") {
      const r = await p1CreateTask({
        model: "nano-banana-pro",
        prompt: REFINE_PROMPT,
        imageUrls,
        aspectRatio: aspect,
        resolution: "2K",
      });
      taskId = r.ok ? (r.task_id ?? null) : null;
      createError = r.ok ? null : (r.error ?? null);
    } else {
      const r = await p3CreateImage({
        model: "nano-banana-pro",
        prompt: REFINE_PROMPT,
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
    return { ok: false, error: `${provider} create failed: ${createError || "unknown"}` };
  }

  // 2. Poll. Each provider has its own status endpoint; the response
  //    shapes were already normalised by their lib wrappers so the
  //    success/failure check is uniform.
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      let status: "running" | "succeeded" | "failed" | "pending" = "pending";
      let outputUrl: string | undefined;
      let pollError: string | undefined;
      if (provider === "p2") {
        const s = await p2GetStatus(taskId, "p2");
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else if (provider === "p1") {
        const s = await p1GetStatus(taskId);
        status = s.status;
        outputUrl = s.outputUrl;
        pollError = s.error;
      } else {
        const s = await p3GetStatus(taskId);
        status = s.status as any;
        outputUrl = s.outputUrl;
        pollError = s.error;
      }
      if (status === "succeeded" && outputUrl) {
        return { ok: true, url: outputUrl };
      }
      if (status === "failed") {
        return { ok: false, error: `${provider} task failed: ${pollError || "unknown"}` };
      }
      // "running" / "pending" — keep polling.
    } catch (e: any) {
      // Transient poll error — keep trying until the tier times out.
      console.warn(`[refine-frame] ${provider} poll error:`, e?.message);
    }
  }
  return { ok: false, error: `${provider} refine timed out (${timeoutMs}ms)` };
}

export async function refineFrameWithProduct(
  opts: RefineOpts
): Promise<RefineResult & { provider?: Provider; tierLog?: string[] }> {
  if (!opts.frameUrl) return { ok: false, error: "Missing frameUrl" };
  if (!opts.productUrl) return { ok: false, error: "Missing productUrl" };

  const tierLog: string[] = [];

  // Default provider: p2 (Crun.ai). Most reliable for nano-banana-pro
  // throughput in production. Fallback: p1 (GeminiGen) → p3 (Mountsea).
  // Same cascade ordering as the video pipeline.
  for (const provider of ["p2", "p1", "p3"] as Provider[]) {
    const r = await tryRefineOn(provider, opts);
    tierLog.push(`${provider}:${r.ok ? "ok" : "fail"}${r.ok ? "" : ` (${r.error})`}`);
    if (r.ok) {
      return { ok: true, url: r.url, provider, tierLog };
    }
    console.warn(`[refine-frame] tier ${provider} failed: ${r.error}`);
  }
  return { ok: false, error: `All refine tiers failed`, tierLog };
}
