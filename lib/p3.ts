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

// ─── TASK STATUS / RESULT ─────────────────────────────────────────────
//
// Polls /gemini/task/result. Returns the same shape p2GetStatus uses
// so settle.ts can branch on provider with minimal code change.
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
    // Result shape: { result: { imageUrls: ["https://..."] } }
    // Sometimes snake_case (image_urls), tolerate both.
    const url =
      data?.result?.imageUrls?.[0] ||
      data?.result?.image_urls?.[0] ||
      data?.result?.url ||
      "";
    if (!url) {
      return {
        status: "failed",
        error: "Mountsea reported completed but no imageUrls in result",
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
