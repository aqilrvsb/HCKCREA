// Mountsea (api.mountsea.ai) image-generation client. Storytelling-only —
// the rest of the platform stays on Crun (p2). We use Mountsea here
// because Crun's /v1/client/job/CreateTask wraps Google's nano-banana
// at a different price point, and Mountsea exposes the same model
// (nano-banana-pro) with a friendlier polling shape + cheaper credits
// for high-volume scene-image batches.
//
// Auth: Bearer header
// Base: https://api.mountsea.ai
// Endpoints used here:
//   POST /gemini/image/generate     — submit image gen task
//   GET  /gemini/task/result?taskId — poll task status / fetch result
//
// Status state machine (data.status string):
//   processing | queued | running → still pending
//   completed                     → success, result.imageUrls[0]
//   failed | cancelled | timeout  → failed (errorMessage available)
//
// Reference implementation that's been battle-tested in
// avatar-studio-mountsea Chrome extension: C:\Users\User\Music\avatar-studio-mountsea\mountsea.js

const MOUNTSEA_BASE = "https://api.mountsea.ai";

export type P3Provider = "p3";

export type P3CreateResult =
  | { ok: true; task_id: string; raw: any; provider: P3Provider }
  | { ok: false; error: string; raw?: any; provider: P3Provider };

export type P3StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

function getApiKey(): string {
  const k = process.env.MOUNTSEA_API_KEY;
  if (!k) {
    throw new Error("MOUNTSEA_API_KEY not configured on Vercel");
  }
  return k;
}

async function msFetch(method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(MOUNTSEA_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// ─── IMAGE — submit task ────────────────────────────────────────────────
//
// Mountsea expects the model id WITHOUT the `google/` prefix that Crun
// uses. Caller passes the bare key (e.g. "nano-banana-pro") and we
// pass it through. Aspect ratio defaults to 9:16 (TikTok / Reels).
// Resolution: 1K | 2K | 4K — only nano-banana-pro and nano-banana-2
// support resolution selection; nano-banana-fast ignores it.
export async function p3CreateImage(input: {
  prompt: string;
  model?: string;       // "nano-banana-pro" | "nano-banana-2" | "nano-banana-fast"
  aspectRatio?: string; // "9:16" | "1:1" | "16:9" | etc.
  resolution?: "1K" | "2K" | "4K";
  /** For edit/img2img — public URLs of reference images. Empty = pure text2img. */
  imageUrls?: string[];
}): Promise<P3CreateResult> {
  const model = input.model || "nano-banana-pro";
  const aspect = input.aspectRatio || "9:16";
  const resolution = input.resolution || "2K";
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());

  const body: any = {
    prompt: input.prompt,
    action: refs.length > 0 ? "edit" : "generate",
    model,
    aspect_ratio: aspect,
    num_images: 1,
    resolution,
  };
  if (refs.length > 0) body.image_urls = refs;

  const { ok, status, data } = await msFetch("POST", "/gemini/image/generate", body);

  if (!ok) {
    const err = data?.errorMessage || data?.error || data?.message || `Mountsea HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p3" };
  }
  const taskId = data?.taskId || data?.task_id || data?.id;
  if (!taskId) {
    return {
      ok: false,
      error: "Mountsea returned no taskId",
      raw: data,
      provider: "p3",
    };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p3" };
}

// ─── VIDEO — submit Veo task ────────────────────────────────────────────
//
// Mountsea Veo 2/3/3.1 wrapper. POST /gemini/video/generate returns a
// taskId; poll via p3GetStatus (same endpoint as image — Mountsea
// unifies the polling path). Used by the video cascade as tier 3
// when p2 (Crun) + p1 (GeminiGen) both fail.
//
// Model mapping (caller's p2-style name → Mountsea's bare key):
//   "google/veo-3.1-fast/*"   → "veo31_fast"
//   "google/veo-3.1/*"        → "veo31_quality"
//   "google/veo-3-fast/*"     → "veo3_fast"
//   "google/veo-3/*"          → "veo3_quality"
//   "google/veo-2-fast/*"     → "veo2_fast"
//   "google/veo-2/*"          → "veo2_quality"
// Action is auto-detected from imageUrls count + model name:
//   • 0 images  → text2video
//   • 1-2       → img2video (start frame / start+end frames)
//   • 3+        → ingredients2video (forced model=veo31_fast_ingredients)
function mountseaVeoModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("veo-3.1-fast") || m.includes("veo3.1-fast") || m.includes("veo31-fast")) return "veo31_fast";
  if (m.includes("veo-3.1") || m.includes("veo3.1") || m.includes("veo31")) return "veo31_quality";
  if (m.includes("veo-3-fast") || m.includes("veo3-fast")) return "veo3_fast";
  if (m.includes("veo-3") || m.includes("veo3")) return "veo3_quality";
  if (m.includes("veo-2-fast") || m.includes("veo2-fast")) return "veo2_fast";
  return "veo2_quality";
}

export async function p3CreateVideo(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  // "ingredient" → ingredients2video (multi r2v refs, 1-3 images).
  // "frame"      → img2video (start frame only, or start + end).
  // "text"       → text2video.
  // Defaults to "ingredient" when refs are present so Auto Content /
  // UGC product references route correctly even with 2 picks (without
  // this the old auto-count routing landed on img2video and Mountsea
  // treated the second image as the end frame instead of a 2nd r2v ref).
  imageMode?: "frame" | "ingredient" | "text";
}): Promise<P3CreateResult> {
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const mode = input.imageMode || (refs.length > 0 ? "ingredient" : "text");
  let action: "text2video" | "img2video" | "ingredients2video";
  if (refs.length === 0 || mode === "text") {
    action = "text2video";
  } else if (mode === "frame") {
    action = "img2video"; // 1 image = start frame, 2 images = start + end
  } else {
    action = "ingredients2video"; // 1-3 reference images (r2v)
  }

  // Mountsea constraint: ingredients2video forces model=veo31_fast_ingredients.
  // For text2video / img2video we use whatever the caller asked for, mapped.
  const requestedModel = mountseaVeoModel(input.model || "veo31_fast");
  const actualModel =
    action === "ingredients2video" ? "veo31_fast_ingredients" : requestedModel;

  const body: any = {
    prompt: input.prompt,
    action,
    model: actualModel,
    aspectRatio: input.aspectRatio || "9:16",
    translation: false,
  };
  if (refs.length > 0) body.imageList = refs.slice(0, action === "ingredients2video" ? 3 : 2);

  const { ok, status, data } = await msFetch("POST", "/gemini/video/generate", body);
  if (!ok) {
    const err = data?.errorMessage || data?.error || data?.message || `Mountsea HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p3" };
  }
  const taskId = data?.taskId || data?.task_id || data?.id;
  if (!taskId) {
    return { ok: false, error: "Mountsea returned no taskId", raw: data, provider: "p3" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p3" };
}

// ─── VIDEO — Grok via Mountsea ────────────────────────────────────────
//
// POST /xai/videos — different endpoint than the Gemini family. Returns
// taskId; poll via p3GetGrokStatus. Used when Viral Normal Video is
// configured to use Grok on Mountsea (admin setting).
export async function p3CreateGrokVideo(input: {
  prompt: string;
  duration?: number;          // 6 | 10 | 12 | 16 | 20
  aspectRatio?: "2:3" | "3:2" | "1:1" | "9:16" | "16:9";
  resolution?: "480P" | "720P";
  imageUrls?: string[];       // up to 5 refs
}): Promise<P3CreateResult> {
  const allowed = [6, 10, 12, 16, 20];
  const dur = allowed.includes(Number(input.duration)) ? Number(input.duration) : 6;
  const body: any = {
    prompt: input.prompt.substring(0, 1000),
    model: "grok-imagine-video",
    duration: dur,
    aspectRatio: input.aspectRatio || "9:16",
    resolution: input.resolution || "720P",
  };
  const refs = (input.imageUrls || []).filter(Boolean).slice(0, 5);
  if (refs.length > 0) body.images = refs;

  const { ok, status, data } = await msFetch("POST", "/xai/videos", body);
  if (!ok) {
    const err = data?.errorMessage || data?.error || data?.message || `Mountsea HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p3" };
  }
  const taskId = data?.taskId || data?.task_id;
  if (!taskId) {
    return { ok: false, error: "Mountsea returned no taskId", raw: data, provider: "p3" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p3" };
}

// ─── TASK STATUS / RESULT ─────────────────────────────────────────────
//
// Polls /gemini/task/result. Returns the same shape p2GetStatus uses
// so settle.ts can branch on provider with minimal code change.
//
// Handles BOTH image AND video results — Mountsea's response has either
// result.imageUrls[] or result.videoUrl depending on the task type.
export async function p3GetStatus(taskId: string): Promise<P3StatusResult> {
  const { ok, status, data } = await msFetch(
    "GET",
    `/gemini/task/result?taskId=${encodeURIComponent(taskId)}`
  );
  if (!ok) {
    return {
      status: "pending",
      error: data?.errorMessage || `Mountsea HTTP ${status}`,
      raw: data,
    };
  }

  const raw = String(data?.status || "").toLowerCase();
  if (raw === "completed") {
    // Result shape varies by task type:
    //   image:  { result: { imageUrls: ["https://..."] } }
    //   video:  { result: { videoUrl: "https://..." } }
    //   grok:   { result: { videoUrl: "https://..." } }  (xai task)
    // Snake_case variants tolerated for forward-compat.
    const url =
      data?.result?.videoUrl ||
      data?.result?.video_url ||
      data?.result?.imageUrls?.[0] ||
      data?.result?.image_urls?.[0] ||
      data?.result?.url ||
      "";
    if (!url) {
      return {
        status: "failed",
        error: "Mountsea reported completed but no imageUrls/videoUrl in result",
        raw: data,
      };
    }
    return { status: "succeeded", outputUrl: String(url), raw: data };
  }
  if (raw === "failed" || raw === "cancelled" || raw === "timeout") {
    return {
      status: "failed",
      error: data?.errorMessage || `Mountsea task ${raw}`,
      raw: data,
    };
  }
  // queued / processing / running / unknown
  return { status: raw === "running" ? "running" : "pending", raw: data };
}

// ─── CREDITS BALANCE (informational) ──────────────────────────────────
//
// Used by an optional admin probe to surface remaining Mountsea
// credits. Not on the hot path. Different host than the main API.
export async function p3CheckCredits(): Promise<number | null> {
  try {
    const r = await fetch("https://dk.mountsea.ai/api-user/credits", {
      headers: { "X-API-Key": getApiKey() },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Number(d?.credits ?? d?.balance ?? 0);
  } catch {
    return null;
  }
}
