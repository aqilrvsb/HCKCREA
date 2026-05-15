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
// separately). aspectRatio takes pixel strings (e.g. "1024x1024"), not
// "16:9" — the cascade caller is responsible for translating if needed.
// We default to 1024x1024 which matches the cascade's text-only Storytelling fallback.
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
      aspectRatio: aspectRatioToPixels(input.aspectRatio),
      imageUrls: input.imageUrls,
    });
  }
  return p4CreateNanoBanana(input);
}

// "9:16" / "16:9" / "1:1" → closest gpt-image-2 pixel size. Grsai's
// gpt-image endpoint demands pixel strings, not ratios, so we map here.
function aspectRatioToPixels(ratio?: string): string {
  switch ((ratio || "").trim()) {
    case "16:9": return "1536x1024";
    case "9:16": return "1024x1536";
    case "1:1":  return "1024x1024";
    default:     return "1024x1024";
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
