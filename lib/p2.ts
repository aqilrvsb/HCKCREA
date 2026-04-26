// Crun.ai (P2) job creation + task status polling helper.
// All keys/URLs read from app_settings via lib/settings.ts so admin can rotate
// without redeploying.

import { getP2Config } from "@/lib/settings";
import { buildP2CallbackUrl } from "@/lib/p2-callback";

export type P2CreateResp = {
  ok: boolean;
  task_id?: string;
  error?: string;
  raw?: any;
};

// Crun.ai's CreateTask endpoint takes a JSON body with `model` at the top
// and model-specific params nested under `input`. Image (nano-banana-pro,
// gpt-image-2) and video (Veo 3.1 fast t2v/i2v/r2v) share this shape but
// have different fields inside `input`. We auto-detect by model id.
export async function p2CreateTask(input: {
  model: string;
  prompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
  durationMode?: "8" | "16";
  aspectRatio?: string;
  resolution?: "1K" | "2K" | "4K";
  imageMode?: "frame" | "ingredient" | "text";
  callbackUrl?: string;
  extra?: Record<string, any>;
}): Promise<P2CreateResp> {
  const cfg = await getP2Config();
  if (!cfg.base || !cfg.key) return { ok: false, error: "P2 not configured" };

  // Coerce single imageUrl into the imageUrls array — Crun expects `img_urls`
  const imgUrls = (input.imageUrls || []).filter(Boolean);
  if (input.imageUrl) imgUrls.unshift(input.imageUrl);

  // Build the `input` block per model type. The three families take very
  // different params — copy-faithful to what the extension's background.js
  // sends so a working extension call works here too.
  const isVideo = input.model.includes("veo");
  const isGptImage = input.model.includes("gpt-image");
  const isBanana = !isVideo && !isGptImage;

  const innerInput: Record<string, any> = {};
  if (input.prompt) innerInput.prompt = input.prompt.substring(0, 5000);

  if (isVideo) {
    // Veo 3.1 fast: duration is a number, only 8 supported on -fast variants
    if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
    if (imgUrls.length > 0) innerInput.img_urls = imgUrls;
    innerInput.duration = Number(input.durationMode || 8);
  } else if (isGptImage) {
    // GPT Image 2: only supports 1:1 / 2:3 / 3:2. Map web aspects to those.
    const ar =
      input.aspectRatio === "16:9"
        ? "3:2"
        : input.aspectRatio === "1:1"
          ? "1:1"
          : "2:3"; // default for 9:16 + anything else
    innerInput.aspect_ratio = ar;
    innerInput.quality = "medium";
    innerInput.background = "auto";
    innerInput.output_format = "png";
    innerInput.moderation = "low";
    if (imgUrls.length > 0) innerInput.img_urls = imgUrls;
  } else if (isBanana) {
    // nano-banana-pro: resolution dial + native aspect ratio support.
    if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
    innerInput.resolution = (input.resolution || "2K").toUpperCase();
    if (imgUrls.length > 0) innerInput.img_urls = imgUrls;
  }

  // Caller-supplied extras override model defaults
  if (input.extra) Object.assign(innerInput, input.extra);

  const body: Record<string, any> = {
    model: input.model,
    input: innerInput,
  };

  // Auto-attach webhook so Crun POSTs back the moment the task finishes.
  // If APP_ORIGIN / CALLBACK_SECRET are missing we silently skip and fall
  // back to the cron poller.
  const callbackUrl = input.callbackUrl ?? buildP2CallbackUrl();
  if (callbackUrl) body.callback_url = callbackUrl;

  const res = await fetch(cfg.base + cfg.createPath, {
    method: "POST",
    headers: {
      "x-api-key": cfg.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    return {
      ok: false,
      error: json?.message || text.substring(0, 300) || `HTTP ${res.status}`,
      raw: json,
    };
  }
  const taskId = json?.data?.task_id || json?.task_id || null;
  if (!taskId) return { ok: false, error: "No task_id returned", raw: json };
  return { ok: true, task_id: String(taskId), raw: json };
}

export type P2StatusResp = {
  ok: boolean;
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

export async function p2GetStatus(taskId: string): Promise<P2StatusResp> {
  const cfg = await getP2Config();
  if (!cfg.base || !cfg.key) return { ok: false, status: "failed", error: "P2 not configured" };

  const res = await fetch(
    `${cfg.base}${cfg.statusPath}?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "x-api-key": cfg.key }, cache: "no-store" }
  );
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    return { ok: false, status: "failed", error: `HTTP ${res.status}`, raw: json };
  }

  const raw = (json?.data?.status || json?.status || "").toLowerCase();
  let status: P2StatusResp["status"] = "pending";
  if (["success", "succeeded", "completed", "done"].includes(raw)) status = "succeeded";
  else if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) status = "failed";
  else if (["running", "processing", "in_progress"].includes(raw)) status = "running";

  const result = json?.data?.result || json?.result || {};
  const outputUrl =
    (Array.isArray(result?.media_urls) ? result.media_urls[0] : null) ||
    result?.video_url ||
    result?.image_url ||
    result?.url ||
    (Array.isArray(result?.urls) ? result.urls[0] : null) ||
    null;

  return { ok: true, status, outputUrl: outputUrl || undefined, raw: json };
}
