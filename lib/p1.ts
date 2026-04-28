// P1 — GeminiGen.AI provider. Alternative backend to P2 (Crun.ai) for Veo
// / Grok / image generation. Mirrors lib/p2.ts function signatures so
// p2CreateTask can dispatch to either backend transparently based on the
// `gen_provider_<asset>` admin setting. The chosen backend is stamped on
// history.metadata.provider so the settle / retry / poll paths know which
// API to query for status later.
//
// Naming follows the original creative-hack-auto extension convention:
//   p1 = GeminiGen.AI   (this file)
//   p2 = Crun.ai        (lib/p2.ts)
//   p3 = RunningHub     (lib/settings.ts → getRunningHubConfig — upload host only)
//
// Docs: https://docs.geminigen.ai
//   - Video Veo:   POST /uapi/v1/video-gen/veo   (multipart form)
//   - Video Grok:  POST /uapi/v1/video-gen/grok  (multipart form)
//   - Image:       POST /uapi/v1/generate_image  (multipart form)
//   - Status:      GET  /uapi/v1/history/{uuid}
// All endpoints take `x-api-key` header.

import { getP1Config } from "@/lib/settings";

export type P1CreateResp = {
  ok: boolean;
  task_id?: string;
  error?: string;
  raw?: any;
};

export type P1StatusResp = {
  ok: boolean;
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

// Map our internal aspect-ratio strings to the format each model expects.
function mapGrokAspect(ar: string): string {
  if (ar === "16:9") return "landscape";
  if (ar === "9:16") return "portrait";
  if (ar === "1:1") return "square";
  if (ar === "2:3") return "vertical";
  if (ar === "3:2") return "horizontal";
  return "portrait";
}

// Pick the closest allowed Grok duration to the requested seconds. The
// GeminiGen Grok endpoint only accepts 6 / 10 / 15.
function quantizeGrokDuration(seconds: number): 6 | 10 | 15 {
  if (seconds <= 7) return 6;
  if (seconds <= 12) return 10;
  return 15;
}

// Translate the model name we got from p2-style admin settings (e.g.
// "veo3.1-fast/r2v" or "grok-imagine/i2v") into the bare model GeminiGen
// expects (e.g. "veo-3.1-fast", "grok-3"). The user passes whatever they
// configured in p2_model_t2v / p2_model_r2v / p2_model_grok_t2v /
// image_default; we normalise here so admin can flip providers without
// also rewriting the model strings.
//
// Aspect-ratio guard: GeminiGen Veo 3.1 / Veo 3.1 Fast / Veo 3.1 Lite
// only support 16:9 widescreen. For 9:16 portrait (our default for UGC /
// TikTok), only veo-2 will accept the request — so we auto-downgrade to
// veo-2 in that case.
function normaliseModelForP1(model: string, aspectRatio?: string): string {
  const m = model.toLowerCase();

  // Grok — only "grok-3" is supported on GeminiGen.
  if (m.includes("grok")) return "grok-3";

  if (m.includes("veo")) {
    const wantsPortrait = aspectRatio === "9:16";
    // Force veo-2 for portrait — it's the only Veo on GeminiGen that
    // accepts 9:16. Veo 3.1 / 3.1-fast / 3.1-lite are all widescreen-only.
    if (wantsPortrait) return "veo-2";

    if (m.includes("fast")) return "veo-3.1-fast";
    if (m.includes("lite")) return "veo-3.1-lite";
    if (m.includes("3.1")) return "veo-3.1";
    if (m.includes("veo2") || m.includes("veo-2")) return "veo-2";
    return "veo-3.1-fast"; // sensible widescreen default
  }

  // Image — nano-banana-pro / nano-banana-2 / imagen-4 are the supported
  // names on GeminiGen.
  if (m.includes("nano-banana-pro") || m.includes("banana-pro")) return "nano-banana-pro";
  if (m.includes("nano-banana") || m.includes("banana-2")) return "nano-banana-2";
  if (m.includes("imagen")) return "imagen-4";

  // gpt-image-2 is Crun-only — return original so the caller can
  // surface a clean error.
  return model;
}

export async function p1CreateTask(input: {
  model: string;
  prompt?: string;
  imageUrls?: string[];
  durationMode?: "8" | "16" | string | number;
  aspectRatio?: string;
  resolution?: string;
  imageMode?: "frame" | "ingredient" | "text";
  extra?: Record<string, any>;
}): Promise<P1CreateResp> {
  const cfg = await getP1Config();
  if (!cfg.base || !cfg.key) {
    return { ok: false, error: "GeminiGen not configured" };
  }

  const isGrok = input.model.toLowerCase().includes("grok");
  const isVideo = !isGrok && input.model.toLowerCase().includes("veo");
  const isImage = !isVideo && !isGrok;

  // Endpoint path varies per asset type.
  const path = isGrok
    ? cfg.grokPath
    : isVideo
      ? cfg.veoPath
      : cfg.imagePath;

  // Normalise the Crun-style model name to GeminiGen's bare-name format
  // (e.g. "veo3.1-fast/r2v" → "veo-3.1-fast", "grok-imagine/i2v" → "grok-3").
  // Aspect-ratio is fed in so the Veo branch can auto-pick veo-2 for the
  // 9:16 portrait case (3.1 tiers are widescreen-only on GeminiGen).
  const normalisedModel = normaliseModelForP1(input.model, input.aspectRatio);
  if (normalisedModel.includes("gpt-image")) {
    return {
      ok: false,
      error: "GeminiGen (P1) does not support gpt-image-2 — switch image provider to P2 (Crun) or pick another model.",
    };
  }

  const fd = new FormData();
  if (input.prompt) fd.append("prompt", input.prompt.substring(0, 5000));
  fd.append("model", normalisedModel);

  const imgUrls = (input.imageUrls || []).filter(Boolean);

  if (isGrok) {
    // Grok takes seconds (6 / 10 / 15) — we quantize the requested duration
    // to the closest supported value.
    const seconds = quantizeGrokDuration(Number(input.durationMode || 6));
    fd.append("duration", String(seconds));
    fd.append("resolution", String(input.resolution || "720p").toLowerCase());
    fd.append("aspect_ratio", mapGrokAspect(input.aspectRatio || "9:16"));
    fd.append("mode", String(input.extra?.mode || "normal"));
    for (const url of imgUrls) fd.append("file_urls", url);
  } else if (isVideo) {
    // Veo 3.1 / 3.1 Fast / 2 — fixed 8s duration (server-side).
    fd.append("aspect_ratio", input.aspectRatio || "9:16");
    fd.append("resolution", String(input.resolution || "720p").toLowerCase());
    if (imgUrls.length > 0) {
      fd.append("mode_image", input.imageMode === "ingredient" ? "ingredient" : "frame");
      for (const url of imgUrls) fd.append("ref_images", url);
    }
  } else if (isImage) {
    // nano-banana-pro / nano-banana-2 / imagen-4
    fd.append("aspect_ratio", input.aspectRatio || "9:16");
    fd.append("output_format", "png");
    fd.append("resolution", String(input.resolution || "2K").toUpperCase());
    if (imgUrls.length > 0) {
      for (const url of imgUrls) fd.append("file_urls", url);
    }
  }

  const res = await fetch(cfg.base + path, {
    method: "POST",
    headers: { "x-api-key": cfg.key },
    body: fd,
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    return {
      ok: false,
      error:
        json?.error_message ||
        json?.message ||
        text.substring(0, 300) ||
        `HTTP ${res.status}`,
      raw: json,
    };
  }
  // Response uses `uuid` as the persistent identifier.
  const uuid = json?.uuid || json?.data?.uuid || json?.id;
  if (!uuid) {
    return { ok: false, error: "No uuid returned", raw: json };
  }
  return { ok: true, task_id: String(uuid), raw: json };
}

export async function p1GetStatus(uuid: string): Promise<P1StatusResp> {
  const cfg = await getP1Config();
  if (!cfg.base || !cfg.key) {
    return { ok: false, status: "failed", error: "GeminiGen not configured" };
  }

  const url = `${cfg.base}${cfg.statusPath.replace("{uuid}", encodeURIComponent(uuid))}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": cfg.key },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    return {
      ok: false,
      status: "failed",
      error: `HTTP ${res.status}`,
      raw: json,
    };
  }

  // Status integer per docs: 1 = processing, 2 = completed, 3 = failed.
  const code = Number(json?.status ?? json?.data?.status ?? 1);
  let status: P1StatusResp["status"] = "pending";
  if (code === 2) status = "succeeded";
  else if (code === 3) status = "failed";
  else if (code === 1) status = "running";

  // Output URL — the GET /history/{uuid} response nests media under
  // generated_video[] (video_url) and generated_image[] (image_url /
  // file_download_url). The legacy generate_result top-level field is
  // sometimes present; cover both shapes.
  const data = json?.data || json;
  const firstVideo = Array.isArray(data?.generated_video) ? data.generated_video[0] : null;
  const firstImage = Array.isArray(data?.generated_image) ? data.generated_image[0] : null;
  const outputUrl =
    firstVideo?.video_url ||
    firstImage?.image_url ||
    firstImage?.file_download_url ||
    data?.generate_result ||
    data?.video_url ||
    data?.media_url ||
    data?.url ||
    (Array.isArray(data?.media_urls) ? data.media_urls[0] : null) ||
    null;

  return {
    ok: true,
    status,
    outputUrl: outputUrl || undefined,
    error:
      status === "failed"
        ? data?.error_message || data?.status_desc || undefined
        : undefined,
    raw: json,
  };
}
