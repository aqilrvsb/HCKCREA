// APIMart (api.apimart.ai) — OpenAI-compatible gateway with cheap Veo +
// Grok video and the full Gemini image family. Used as:
//   • Image cascade middle tier: p4 → p5 → p2
//   • Video cascade tier 3:     p2-A → p2-B → p5
//
// Why p5 fits both:
//   • Different vendor than Crun (p2) and Grsai (p4) — survives a
//     Crun-platform-wide outage that p2-A + p2-B can't.
//   • Flat per-call pricing on Veo 3.1 Fast ($0.08/gen) — even cheaper
//     than MaxAPI's $0.10, ~10× cheaper than ZenMux's $1.20.
//   • Same /v1/images/generations endpoint accepts gpt-image-2 +
//     Gemini 3 Pro/3.1 Flash/2.5 Flash via model name. One client
//     covers the whole image lineup.
//
// Auth: Bearer header
// Base: https://api.apimart.ai
// Endpoints used here:
//   POST /v1/images/generations  — submit image gen task
//   POST /v1/videos/generations  — submit video gen task
//   GET  /v1/tasks/{task_id}?language=en — poll task status / result
//
// Response wrapping quirk: APIMart wraps single results in nested arrays,
// e.g. result.images[0].url is itself a string-array (not a string).
// We unwrap defensively when reading the output URL.
//
// Status state machine (data.status string):
//   pending / processing → still pending
//   completed            → success, result.images[0].url[0] OR result.videos[0].url[0]
//   failed / cancelled   → failed (error.message)

import { getP5Config } from "@/lib/settings";

const P5_BASE = "https://api.apimart.ai";

export type P5Provider = "p5";

export type P5CreateResult =
  | { ok: true; task_id: string; raw: any; provider: P5Provider }
  | { ok: false; error: string; raw?: any; provider: P5Provider };

export type P5StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

async function p5Fetch(method: "POST" | "GET", path: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const cfg = await getP5Config();
  if (!cfg.key) {
    throw new Error("p5_key not configured in app_settings");
  }
  const r = await fetch(P5_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Map our internal aspect ratio strings to APIMart's `size` values for
// images. APIMart only documents 1:1 / 2:3 / 3:2 — map portrait/landscape
// to the closest supported size. Other ratios pass through (APIMart
// rejects unsupported values, which trips the cascade to next tier).
function imageSize(aspectRatio?: string): string {
  switch ((aspectRatio || "").trim()) {
    case "9:16":
    case "2:3":
      return "2:3";
    case "16:9":
    case "3:2":
      return "3:2";
    case "1:1":
      return "1:1";
    default:
      return aspectRatio || "1:1";
  }
}

// Translate cascade model names into APIMart's catalog names.
// Cascade uses bare names (nano-banana-pro / nano-banana-2 / nano-banana /
// nano-banana-fast / gpt-image-2). APIMart uses Gemini-prefixed names
// for the Banana variants.
function apimartImageModel(model?: string): string {
  const m = (model || "").toLowerCase();
  if (m === "nano-banana-pro") return "gemini-3-pro-image-preview";
  if (m === "nano-banana-2") return "gemini-3.1-flash-image-preview";
  if (m === "nano-banana" || m === "nano-banana-fast") {
    // APIMart doesn't expose a "fast" variant; fall back to Gemini 2.5
    // Flash which is the spiritual equivalent (cheapest, fastest).
    return "gemini-2.5-flash-image-preview";
  }
  if (m.includes("gpt-image")) return "gpt-image-2";
  return model || "gemini-3-pro-image-preview";
}

// ─── IMAGE — submit ─────────────────────────────────────────────────
export async function p5CreateImage(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
}): Promise<P5CreateResult> {
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const body: any = {
    model: apimartImageModel(input.model),
    prompt: input.prompt.slice(0, 1000),
    size: imageSize(input.aspectRatio),
    n: 1,
  };
  if (refs.length > 0) body.image_urls = refs.slice(0, 5);

  const { ok, status, data } = await p5Fetch("POST", "/v1/images/generations", body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `APIMart HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p5" };
  }
  const taskId = data?.data?.[0]?.task_id || data?.task_id || data?.id;
  if (!taskId) {
    return { ok: false, error: "APIMart returned no task_id", raw: data, provider: "p5" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p5" };
}

// ─── VIDEO — submit ─────────────────────────────────────────────────
//
// Veo 3.1 Fast is fixed at 8s, ratios 9:16 or 16:9. Grok Imagine is
// per-second-billed and accepts the model name verbatim. We forward
// whatever the cascade passes; APIMart rejects unsupported combinations
// with a 4xx that trips the cascade to next tier.
//
// generation_type:
//   "frame"     → first/last frame i2v (1-2 images)
//   "reference" → r2v / ingredients (1-3 reference images)
//   (omit for text2video)
export async function p5CreateVideo(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
  resolution?: "720p" | "1080p" | "4k";
}): Promise<P5CreateResult> {
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  // Cascade model strings can be "google/veo-3.1-fast/r2v" etc — map.
  const m = (input.model || "").toLowerCase();
  let model = input.model || "veo3.1-fast";
  if (m.includes("veo") && m.includes("fast")) model = "veo3.1-fast";
  else if (m.includes("veo") && m.includes("quality")) model = "veo3.1-quality";
  else if (m.includes("veo") && m.includes("lite")) model = "veo3.1-lite";
  else if (m.includes("veo")) model = "veo3.1-fast";
  else if (m.includes("grok")) model = "grok-imagine-1.0-video-apimart";

  const mode = input.imageMode || (refs.length > 0 ? "ingredient" : "text");
  const generationType =
    mode === "frame" ? "frame" : mode === "ingredient" && refs.length > 0 ? "reference" : undefined;

  const body: any = {
    model,
    // 8000-char cap. Previously 4000, before that 2000 — kept hitting
    // the next ceiling as the canonical lock block grew. Production
    // rows in May 2026 truncated mid-MODESTY-LOCK at the 4000 mark.
    // Real prompts land at ~4500-5000 chars with all locks + LLM
    // scene description; 8000 leaves ~30% headroom. APIMart forwards
    // verbatim to Veo, which accepts well above this.
    prompt: input.prompt.slice(0, 8000),
    duration: Number(input.durationMode) || 8,
    aspect_ratio: input.aspectRatio || "9:16",
  };
  if (input.resolution) body.resolution = input.resolution;
  if (refs.length > 0) body.image_urls = refs.slice(0, 3);
  if (generationType) body.generation_type = generationType;

  const { ok, status, data } = await p5Fetch("POST", "/v1/videos/generations", body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `APIMart HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p5" };
  }
  const taskId = data?.data?.[0]?.task_id || data?.task_id || data?.id;
  if (!taskId) {
    return { ok: false, error: "APIMart returned no task_id", raw: data, provider: "p5" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p5" };
}

// ─── TASK STATUS / RESULT ─────────────────────────────────────────────
//
// APIMart wraps result URLs in nested arrays:
//   images: [{ url: ["https://..."] }]
//   videos: [{ url: ["https://..."] }]
// Defensively unwrap to a single string URL for the cascade's polling
// loop which expects outputUrl: string.
function unwrapUrl(node: any): string | undefined {
  if (!node) return undefined;
  const inner = node.url ?? node;
  if (Array.isArray(inner)) return typeof inner[0] === "string" ? inner[0] : undefined;
  if (typeof inner === "string") return inner;
  return undefined;
}

export async function p5GetStatus(taskId: string): Promise<P5StatusResult> {
  const { ok, status, data } = await p5Fetch(
    "GET",
    `/v1/tasks/${encodeURIComponent(taskId)}?language=en`
  );
  if (!ok) {
    return {
      status: "pending",
      error: data?.error?.message || `APIMart HTTP ${status}`,
      raw: data,
    };
  }
  const payload = data?.data || data;
  const taskStatus = String(payload?.status || "").toLowerCase();

  if (taskStatus === "completed") {
    const url =
      unwrapUrl(payload?.result?.images?.[0]) ||
      unwrapUrl(payload?.result?.videos?.[0]) ||
      payload?.result?.url ||
      "";
    if (!url) {
      return {
        status: "failed",
        error: "APIMart reported completed but no result url",
        raw: data,
      };
    }
    return { status: "succeeded", outputUrl: String(url), raw: data };
  }
  if (taskStatus === "failed" || taskStatus === "cancelled") {
    return {
      status: "failed",
      error: payload?.error?.message || data?.error?.message || `APIMart task ${taskStatus}`,
      raw: data,
    };
  }
  return { status: taskStatus === "processing" ? "running" : "pending", raw: data };
}
