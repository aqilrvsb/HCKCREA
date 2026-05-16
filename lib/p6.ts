// APIPod (api.apipod.ai) — Google Veo + Grok video gateway.
//
// Multi-key architecture: each slot p6-a … p6-h has its own API key
// stored in app_settings.p6_key_<letter>. Admin picks any subset of
// the 8 slots in the cascade rotation. This is identical to the p2-a
// / p2-b pattern but extended to 8 keys to spread rate-limit load
// across more APIPod accounts during high-volume periods (e.g. when
// the underlying Google Veo 3.1 endpoint is rate-limiting any single
// account).
//
// Auth: Bearer header (per-key)
// Base: https://api.apipod.ai
// Endpoints:
//   POST /v1/videos/generations    — submit Veo / Grok
//   GET  /v1/videos/status/{id}    — poll task status
//
// APIPod scopes task_ids per account — settle.ts MUST poll with the
// same key that submitted. The cascade stamps the slot label (p6-a
// etc) on metadata.slot so settle can look up the right key.

import { getSettings } from "@/lib/settings";

const P6_BASE = "https://api.apipod.ai";

export type P6Slot = "p6-a" | "p6-b" | "p6-c" | "p6-d" | "p6-e" | "p6-f" | "p6-g" | "p6-h";
export const P6_SLOTS: P6Slot[] = ["p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h"];

export type P6Provider = "p6";

export type P6CreateResult =
  | { ok: true; task_id: string; raw: any; provider: P6Provider }
  | { ok: false; error: string; raw?: any; provider: P6Provider };

export type P6StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

// Map slot label → app_settings key name.
function slotToSettingKey(slot: P6Slot): string {
  return `p6_key_${slot.slice(3)}`; // p6-a → "p6_key_a"
}

// Look up the API key for a given p6-x slot. Returns "" if not set.
export async function getP6KeyForSlot(slot: P6Slot): Promise<string> {
  const k = slotToSettingKey(slot);
  const s = await getSettings([k]);
  return String((s as any)[k]?.key || "").trim();
}

// Read all 8 keys at once (for admin UI / debugging).
export async function getAllP6Keys(): Promise<Record<P6Slot, string>> {
  const settingKeys = P6_SLOTS.map(slotToSettingKey);
  const s = await getSettings(settingKeys);
  const out: any = {};
  for (const slot of P6_SLOTS) {
    out[slot] = String((s as any)[slotToSettingKey(slot)]?.key || "").trim();
  }
  return out as Record<P6Slot, string>;
}

// Map cascade video model strings → APIPod's catalog names. Per
// APIPod docs the model IDs are mode-specific:
//   • Veo 3.1 Fast      → veo-3-1-fast (dashes only, CUE validator)
//   • Grok Imagine t2v  → grok-imagine-t2v  (no image_urls)
//   • Grok Imagine i2v  → grok-imagine-i2v  (1-7 image_urls)
//   • Seedance 2.0 Fast → seedance-2.0-fast-{t2v|i2v|r2v}
//       - t2v: text only
//       - i2v: single start-frame image (frame mode)
//       - r2v: 1-3 reference images (ingredient mode)
function apipodVideoModel(input: {
  model?: string;
  imageMode?: "frame" | "ingredient" | "text";
  imageUrls?: string[];
}): string {
  const m = (input.model || "").toLowerCase();
  const refs = input.imageUrls?.length || 0;
  const mode = input.imageMode || (refs > 0 ? "ingredient" : "text");

  if (m.includes("grok")) {
    return refs > 0 && mode !== "text" ? "grok-imagine-i2v" : "grok-imagine-t2v";
  }

  if (m.includes("seedance")) {
    if (refs === 0 || mode === "text") return "seedance-2.0-fast-t2v";
    if (mode === "frame") return "seedance-2.0-fast-i2v";
    return "seedance-2.0-fast-r2v";
  }

  return "veo-3-1-fast";
}

// Map cascade image model strings → APIPod's catalog names. Per
// APIPod docs:
//   • gpt-image-2       → text-to-image
//   • gpt-image-2-edit  → image-to-image edit (requires image_urls)
//   • nano-banana-pro   → up to 8 reference images
//   • nano-banana-2     → up to 14 reference images
function apipodImageModel(model: string | undefined, hasImages: boolean): string {
  const m = (model || "").toLowerCase();
  if (m.includes("gpt-image")) {
    return hasImages ? "gpt-image-2-edit" : "gpt-image-2";
  }
  if (m === "nano-banana-pro" || m === "google/nano-banana-pro") return "nano-banana-pro";
  if (m === "nano-banana-2" || m === "google/nano-banana-2") return "nano-banana-2";
  return "nano-banana-pro";
}

async function p6Fetch(
  method: "POST" | "GET",
  path: string,
  apiKey: string,
  body?: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(P6_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Submit a video task with the key configured for the given slot.
// Returns "p6_key_x not configured" if the slot's key is empty, which
// trips the cascade to the next slot.
export async function p6CreateVideo(input: {
  slot: P6Slot;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
}): Promise<P6CreateResult> {
  const apiKey = await getP6KeyForSlot(input.slot);
  if (!apiKey) {
    return { ok: false, error: `${slotToSettingKey(input.slot)} not configured`, provider: "p6" };
  }
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const resolvedModel = apipodVideoModel({
    model: input.model,
    imageMode: input.imageMode,
    imageUrls: refs,
  });
  const body: any = {
    model: resolvedModel,
    prompt: input.prompt.slice(0, 2000),
    aspect_ratio: input.aspectRatio || "9:16",
  };

  // Per-model image_urls cap per APIPod docs:
  //   • grok-imagine-i2v        → 1-7
  //   • seedance-2.0-fast-i2v   → 1   (start frame only)
  //   • seedance-2.0-fast-r2v   → 1-3 (ingredient mode)
  //   • veo-3-1-fast            → up to 3
  if (refs.length > 0) {
    let cap = 3;
    if (resolvedModel === "grok-imagine-i2v") cap = 7;
    else if (resolvedModel === "seedance-2.0-fast-i2v") cap = 1;
    else if (resolvedModel === "seedance-2.0-fast-r2v") cap = 3;
    body.image_urls = refs.slice(0, cap);
  }

  // Seedance requires `duration` (4-15). Veo and Grok ignore it, but
  // we send a sensible default so the cascade can swap models without
  // re-plumbing the call site.
  const reqDur = Number(input.durationMode);
  const duration =
    Number.isFinite(reqDur) && reqDur >= 4 && reqDur <= 15
      ? Math.round(reqDur)
      : resolvedModel.startsWith("seedance")
        ? 5
        : resolvedModel.startsWith("grok-imagine")
          ? 6
          : 8;
  body.duration = duration;

  const { ok, status, data } = await p6Fetch("POST", "/v1/videos/generations", apiKey, body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `APIPod HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p6" };
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) {
    return { ok: false, error: "APIPod returned no task_id", raw: data, provider: "p6" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p6" };
}

// Submit an image task with the key configured for the given slot.
// Same auth + status pattern as video, just different endpoint and
// model-name mapping.
export async function p6CreateImage(input: {
  slot: P6Slot;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  quality?: "1K" | "2K" | "4K";
}): Promise<P6CreateResult> {
  const apiKey = await getP6KeyForSlot(input.slot);
  if (!apiKey) {
    return { ok: false, error: `${slotToSettingKey(input.slot)} not configured`, provider: "p6" };
  }
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const resolvedModel = apipodImageModel(input.model, refs.length > 0);
  const body: any = {
    model: resolvedModel,
    prompt: input.prompt.slice(0, 4000),
    aspect_ratio: input.aspectRatio || "1:1",
    quality: input.quality || "2K",
  };

  // Per-model image_urls cap per APIPod docs:
  //   • gpt-image-2-edit  → at least 1 required
  //   • nano-banana-pro   → up to 8
  //   • nano-banana-2     → up to 14
  if (refs.length > 0) {
    const cap = resolvedModel === "nano-banana-2" ? 14 : 8;
    body.image_urls = refs.slice(0, cap);
  }

  const { ok, status, data } = await p6Fetch("POST", "/v1/images/generations", apiKey, body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `APIPod HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p6" };
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) {
    return { ok: false, error: "APIPod returned no task_id", raw: data, provider: "p6" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p6" };
}

// Poll task status with the key that submitted it. slot is the
// stamped metadata.slot from the history row. `assetKind` picks
// between /v1/videos/status/ (default) and /v1/images/status/.
export async function p6GetStatus(
  taskId: string,
  slot?: P6Slot,
  assetKind: "video" | "image" = "video"
): Promise<P6StatusResult> {
  const pollPath = assetKind === "image"
    ? `/v1/images/status/${encodeURIComponent(taskId)}`
    : `/v1/videos/status/${encodeURIComponent(taskId)}`;
  // If slot is known (from metadata), poll with that key directly.
  if (slot) {
    const apiKey = await getP6KeyForSlot(slot);
    if (apiKey) {
      return pollOnce(pollPath, apiKey);
    }
  }
  // Fallback for legacy rows: walk all configured keys until one
  // returns a meaningful response.
  const all = await getAllP6Keys();
  for (const s of P6_SLOTS) {
    const k = all[s];
    if (!k) continue;
    const r = await pollOnce(pollPath, k);
    if (r.status === "succeeded" || r.status === "failed" || r.status === "running") {
      return r;
    }
  }
  return { status: "pending" };
}

async function pollOnce(pollPath: string, apiKey: string): Promise<P6StatusResult> {
  const { ok, status, data } = await p6Fetch("GET", pollPath, apiKey);
  if (!ok) {
    return {
      status: "pending",
      error: data?.error?.message || `APIPod HTTP ${status}`,
      raw: data,
    };
  }
  const payload = data?.data || data;
  const taskStatus = String(payload?.status || "").toLowerCase();
  if (taskStatus === "completed") {
    const url =
      (Array.isArray(payload?.result) ? payload.result[0] : null) ||
      payload?.result?.url ||
      "";
    if (!url) {
      return { status: "failed", error: "APIPod completed but no result url", raw: data };
    }
    return { status: "succeeded", outputUrl: String(url), raw: data };
  }
  if (taskStatus === "failed" || taskStatus === "cancelled") {
    return {
      status: "failed",
      error: payload?.error || `APIPod task ${taskStatus}`,
      raw: data,
    };
  }
  return { status: taskStatus === "processing" ? "running" : "pending", raw: data };
}
