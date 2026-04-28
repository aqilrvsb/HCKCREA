// Crun.ai (P2) job creation + task status polling helper.
// All keys/URLs read from app_settings via lib/settings.ts so admin can rotate
// without redeploying.
//
// PROVIDER ROUTING — `p2CreateTask` is the single entry point every generation
// route uses. Internally it dispatches to either Crun.ai (P2) or
// GeminiGen.AI based on the `gen_provider_<asset>` admin setting. The
// chosen provider is returned as `provider` so callers can stamp it onto
// `history.metadata.provider` for the settle path.

import { getP2Config, getGenProvider } from "@/lib/settings";
import { buildP2CallbackUrl } from "@/lib/p2-callback";
import { p1CreateTask, p1GetStatus } from "@/lib/p1";

export type P2CreateResp = {
  ok: boolean;
  task_id?: string;
  /** Which backend actually fulfilled this create call. Caller should
   *  persist this on the history row's metadata so status polls dispatch
   *  to the right backend after the fact. */
  provider?: "p1" | "p2";
  error?: string;
  raw?: any;
};

// Pick a gen-provider based on the model name + admin toggle. Image vs
// video vs cinema each have their own gen_provider_<asset> setting so
// admin can rotate backends per asset class. For video specifically, a
// per-user preference (profiles.video_provider) takes precedence over
// the admin default — pass userId so the user override is honoured.
async function pickProvider(model: string, userId?: string): Promise<"p1" | "p2"> {
  const isGrok = model.includes("grok");
  const isVideo = !isGrok && model.includes("veo");
  const asset = isGrok ? "cinema" : isVideo ? "video" : "image";
  return await getGenProvider(asset, userId);
}

// Public entry point — dispatches to either P1 (GeminiGen) or P2 (Crun.ai)
// based on the gen_provider_<asset> admin setting. Returns the same shape
// regardless of backend, plus a `provider` field so callers can persist
// it on history.metadata for status polls later.
//
// userId is optional but recommended for video calls — it lets the
// dispatcher respect the per-user video_provider preference set in the
// client's /settings page. Image + cinema currently ignore it.
export async function p2CreateTask(input: {
  model: string;
  userId?: string;
  prompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
  durationMode?: "8" | "16" | string | number;
  aspectRatio?: string;
  resolution?: "1K" | "2K" | "4K" | "480p" | "720p" | string;
  imageMode?: "frame" | "ingredient" | "text";
  callbackUrl?: string;
  extra?: Record<string, any>;
}): Promise<P2CreateResp> {
  const provider = await pickProvider(input.model, input.userId);
  if (provider === "p1") {
    const r = await p1CreateTask({
      model: input.model,
      prompt: input.prompt,
      imageUrls: input.imageUrls,
      durationMode: input.durationMode,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      imageMode: input.imageMode,
      extra: input.extra,
    });
    return {
      ok: r.ok,
      task_id: r.task_id,
      error: r.error,
      raw: r.raw,
      provider: "p1",
    };
  }
  return p2CreateTaskInternal(input);
}

// P2 (Crun.ai) — original implementation. Untouched call shape so any
// existing tests / call sites still work via the dispatcher above.
async function p2CreateTaskInternal(input: {
  model: string;
  prompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
  durationMode?: "8" | "16" | string | number;
  aspectRatio?: string;
  resolution?: "1K" | "2K" | "4K" | "480p" | "720p" | string;
  imageMode?: "frame" | "ingredient" | "text";
  callbackUrl?: string;
  extra?: Record<string, any>;
}): Promise<P2CreateResp> {
  const cfg = await getP2Config();
  if (!cfg.base || !cfg.key) return { ok: false, error: "P2 not configured", provider: "p2" };

  // Coerce single imageUrl into the imageUrls array — Crun expects `img_urls`
  const imgUrls = (input.imageUrls || []).filter(Boolean);
  if (input.imageUrl) imgUrls.unshift(input.imageUrl);

  // Build the `input` block per model type. Each family takes different
  // params — copy-faithful to what the extension's background.js + Crun
  // docs specify so a working call there works here too.
  const isGrok = input.model.includes("grok-imagine");
  const isVideo = !isGrok && input.model.includes("veo");
  const isGptImage = !isGrok && input.model.includes("gpt-image");
  const isBanana = !isVideo && !isGptImage && !isGrok;

  const innerInput: Record<string, any> = {};
  if (input.prompt) innerInput.prompt = input.prompt.substring(0, 5000);

  if (isGrok) {
    // Grok Imagine — t2v takes aspect_ratio, i2v doesn't (inherits from img).
    // Both take duration (6-30), resolution (480p|720p), mode (fun|normal|spicy).
    const isI2V = input.model.includes("i2v");
    if (isI2V) {
      if (imgUrls.length > 0) innerInput.img_urls = imgUrls;
    } else {
      if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
    }
    innerInput.duration = Number(input.durationMode || 6);
    innerInput.resolution = input.resolution
      ? String(input.resolution).toLowerCase()
      : "720p";
    innerInput.mode =
      (input.extra?.mode as string) === "fun" ||
      (input.extra?.mode as string) === "spicy"
        ? input.extra!.mode
        : "normal";
  } else if (isVideo) {
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
      provider: "p2",
    };
  }
  const taskId = json?.data?.task_id || json?.task_id || null;
  if (!taskId) return { ok: false, error: "No task_id returned", raw: json, provider: "p2" };
  return { ok: true, task_id: String(taskId), raw: json, provider: "p2" };
}

export type P2StatusResp = {
  ok: boolean;
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

// Status dispatcher — picks the backend by the row's `metadata.provider`
// (set at create-task time). Defaults to p2 for backward compat with rows
// inserted before the dispatcher landed.
export async function p2GetStatus(
  taskId: string,
  provider?: "p1" | "p2"
): Promise<P2StatusResp> {
  const useP1 = provider === "p1";
  if (useP1) {
    const r = await p1GetStatus(taskId);
    return {
      ok: r.ok,
      status: r.status,
      outputUrl: r.outputUrl,
      error: r.error,
      raw: r.raw,
    };
  }

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

  // Surface upstream provider error so the user sees "Server exception, please
  // try again later" rather than a useless "Generation failed". Crun returns
  // a non-200 code inside data.result.message on provider-side failures.
  const upstreamError =
    status === "failed"
      ? result?.message ||
        json?.data?.message ||
        json?.message ||
        undefined
      : undefined;

  return {
    ok: true,
    status,
    outputUrl: outputUrl || undefined,
    error: upstreamError,
    raw: json,
  };
}
