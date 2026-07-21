// Grsai (grsaiapi.com) image-generation client. Image-only — Veo + Grok
// stay on p2 (Crun). p4 replaces p3 as the bidirectional fallback partner
// for p2 on image rows because Grsai is materially cheaper per 2K image
// (~3× Banana Pro, ~2× Banana 2) and exposes nano-banana-fast which we
// route to from Storytelling for high-volume scene-image batches.
//
// Auth: Bearer header
// Base: https://grsaiapi.com  (Global host; .com.cn mirror exists but
//   we never use it — geofencing on .cn would block our Vercel egress.)
// Endpoints used here:
//   POST /v1/draw/nano-banana    — Nano Banana family submit
//   POST /v1/draw/completions    — gpt-image-2 submit
//   POST /v1/draw/result         — poll task status / fetch result
//
// We always pass webHook="-1" on submit so Grsai returns an id
// immediately instead of streaming. settle.ts polls /v1/draw/result on
// the same schedule it uses for p1/p2/p3.
//
// Status state machine (data.status string):
//   running                       → still pending
//   succeeded                     → success, result.results[0].url
//   failed                        → failed (failure_reason / error field)

import { getP4Config } from "@/lib/settings";

const P4_BASE = "https://grsaiapi.com";

export type P4Provider = "p4";

export type P4CreateResult =
  | { ok: true; task_id: string; raw: any; provider: P4Provider }
  | { ok: false; error: string; raw?: any; provider: P4Provider };

export type P4StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

async function p4Fetch(path: string, body: any): Promise<{ ok: boolean; status: number; data: any }> {
  const cfg = await getP4Config();
  if (!cfg.key) {
    throw new Error("p4_key not configured in app_settings");
  }
  const r = await fetch(P4_BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Nano Banana family. Caller passes the bare model key
// ("nano-banana", "nano-banana-2", "nano-banana-fast", "nano-banana-pro");
// we forward unchanged because Grsai uses the same naming. `imageSize`
// only matters for nano-banana-2 and nano-banana-pro — ignored by fast.
export async function p4CreateNanoBanana(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageUrls?: string[];
}): Promise<P4CreateResult> {
  const model = input.model || "nano-banana-pro";
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const body: any = {
    model,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio || "9:16",
    imageSize: input.imageSize || "2K",
    webHook: "-1",
    shutProgress: true,
  };
  if (refs.length > 0) body.urls = refs;

  const { ok, status, data } = await p4Fetch("/v1/draw/nano-banana", body);
  if (!ok || data?.code !== 0) {
    const err = data?.msg || data?.error || `Grsai HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p4" };
  }
  const taskId = data?.data?.id || data?.id;
  if (!taskId) {
    return { ok: false, error: "Grsai returned no task id", raw: data, provider: "p4" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p4" };
}

// GPT Image 2. Different endpoint than Nano Banana (Grsai routes them
// separately). aspectRatio accepts a RATIO ("9:16") or a 1K pixel string
// ("1024x1024") — see gptImageAspect below, which normalises per model.
export async function p4CreateGptImage(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  imageUrls?: string[];
}): Promise<P4CreateResult> {
  const model = input.model || "gpt-image-2";
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const body: any = {
    model,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio || "1024x1024",
    quality: input.quality || "auto",
    webHook: "-1",
    shutProgress: true,
  };
  if (refs.length > 0) body.urls = refs;

  const { ok, status, data } = await p4Fetch("/v1/draw/completions", body);
  if (!ok || data?.code !== 0) {
    const err = data?.msg || data?.error || `Grsai HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p4" };
  }
  const taskId = data?.data?.id || data?.id;
  if (!taskId) {
    return { ok: false, error: "Grsai returned no task id", raw: data, provider: "p4" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p4" };
}

// Unified create — routes to the correct endpoint based on model name.
// Used by image-cascade.ts so the cascade doesn't have to know about
// Grsai's split endpoints.
export async function p4CreateImage(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageUrls?: string[];
}): Promise<P4CreateResult> {
  const m = (input.model || "").toLowerCase();
  if (m.includes("gpt-image")) {
    return p4CreateGptImage({
      prompt: input.prompt,
      model: input.model,
      aspectRatio: gptImageAspect(input.aspectRatio, input.model || "gpt-image-2"),
      imageUrls: input.imageUrls,
    });
  }
  return p4CreateNanoBanana(input);
}

// Aspect ratio for Grsai's gpt-image endpoint.
//
// Per Grsai's docs, `gpt-image-2` accepts a RATIO directly ("9:16" → 941x1672)
// as well as 1K pixel strings. Only `gpt-image-2-vip` is pixel-only.
//
// This used to map every ratio to pixels, and mapped "9:16" → "1024x1536" —
// which is Grsai's own 2:3 size (0.667), not 9:16 (0.5625). Every 9:16 image
// (covers, storyboards, references) silently came back 2:3. Passing the ratio
// through fixes all of them at once.
function gptImageAspect(ratio: string | undefined, model: string): string {
  const r = (ratio || "").trim();
  if (!model.toLowerCase().includes("vip")) {
    // Ratios AND explicit pixel strings both pass through untouched.
    return r || "1:1";
  }
  // gpt-image-2-vip does NOT accept ratios — pixel values only (2K tier).
  switch (r) {
    case "16:9": return "2048x1152";
    case "9:16": return "1152x2048";
    case "1:1":  return "2048x2048";
    case "4:3":  return "2304x1728";
    case "3:4":  return "1728x2304";
    case "3:2":  return "2048x1360";
    case "2:3":  return "1360x2048";
    case "4:5":  return "1792x2240";
    case "5:4":  return "2240x1792";
    default:     return /^\d+x\d+$/.test(r) ? r : "2048x2048";
  }
}

// Poll /v1/draw/result. Same response shape as the stream/webhook reply
// (Grsai is consistent across delivery modes). Status values:
//   "running" / undefined → pending
//   "succeeded"           → result.results[0].url
//   "failed"              → error or failure_reason
export async function p4GetStatus(taskId: string): Promise<P4StatusResult> {
  const { ok, status, data } = await p4Fetch("/v1/draw/result", { id: taskId });
  if (!ok || (data?.code !== 0 && data?.code !== undefined)) {
    return {
      status: "pending",
      error: data?.msg || `Grsai HTTP ${status}`,
      raw: data,
    };
  }
  // /v1/draw/result wraps the task payload in data; stream/webhook puts
  // it at the top level. Accept either.
  const payload = data?.data || data;
  const taskStatus = String(payload?.status || "").toLowerCase();
  if (taskStatus === "succeeded") {
    const url =
      payload?.results?.[0]?.url ||
      payload?.url ||
      "";
    if (!url) {
      return {
        status: "failed",
        error: "Grsai reported succeeded but no result url",
        raw: data,
      };
    }
    return { status: "succeeded", outputUrl: String(url), raw: data };
  }
  if (taskStatus === "failed") {
    const reason = payload?.failure_reason || payload?.error || "Grsai task failed";
    return { status: "failed", error: String(reason), raw: data };
  }
  return { status: taskStatus === "running" ? "running" : "pending", raw: data };
}
