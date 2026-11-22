// ToAPIs (toapis.com — JINGSHU INTELLIGENT LIMITED, Hong Kong) — the "p10" provider.
//
// Since 2026-11-20 every PeningLab video runs here: Gemini Omni 1.2 (Storyboard, Dialog UGC, Original Video) and
// Grok Video 1.5 (Dialog UGC, Original Video, the Editor intro). Cascade = main p10 + fallback p10 ×2, so a job gets
// three ToAPIs attempts before the error is shown (owner's rule).
//
//   Omni 1.2  POST /v1/videos               model gemini-omni-1.2-flash-preview · 4–15 s · 720p · 16:9 | 9:16
//             text only | first_image_url (+ last_image_url) | image_urls (≤ 5 references, mutually exclusive)
//             Flat $0.20 per clip whatever the length (verified). References mode carries Google's visible ✦
//             watermark — the owner accepted it.
//   Grok 1.5  POST /v1/videos/generations   model grok-video-1.5 · 1–15 s · 480p / 720p / 1080p
//             video_generation_mode text_to_video | first_frame_image_to_video (image) | reference_images_to_video
//             (1–7). A first frame keeps the INPUT IMAGE's shape (a landscape photo gives a landscape clip).
//             $0.0191/s at 720p (verified 1, 4, 6, 8, 10, 15 s).
//   Status    GET /v1/tasks/{id} — the one address that answers for both models. Do NOT poll an Omni-style
//             /v1/videos/{id} for a Grok task: it answers HTTP 501 "Generation failed" for a task that succeeded.
//
// Key: app_settings.toapis_key = { key, base }. Image URLs must be public (no base64). Outputs stay 30 days on
// files.toapis.com.

import { getSetting } from "@/lib/settings";
import { hideBrand } from "@/lib/hide-brand";

export type P10CreateResult =
  | { ok: true; task_id: string; model: string; raw: any; provider: "p10" }
  | { ok: false; error: string; raw?: any; provider: "p10" };

export type P10StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

export const P10_OMNI_MODEL = "gemini-omni-1.2-flash-preview";
export const P10_GROK_MODEL = "grok-video-1.5";

async function p10Config(): Promise<{ base: string; key: string }> {
  const s = await getSetting<{ key?: string; base?: string }>("toapis_key");
  const base = String(s?.base || "https://toapis.com/v1").replace(/\/+$/, "").replace(/\/v1$/, "");
  return { base, key: String(s?.key || "").trim() };
}

/** Which ToAPIs model a cascade model id maps to (null = not served on p10). */
export function p10ModelFor(model: string | undefined): "omni" | "grok" | null {
  const m = String(model || "").toLowerCase();
  if (m.includes("grok")) return "grok";
  if (m.includes("gemini") || m.includes("omni")) return "omni";
  return null;
}

async function p10Fetch(method: "GET" | "POST", url: string, key: string, body?: any, timeoutMs = 60_000) {
  try {
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = await r.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { ok: r.ok, status: r.status, data, text };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, text: `P10 network error: ${e?.message || "fetch failed"}` };
  }
}

// Clients only ever see "P10" — never the upstream brand (owner 2026-11-22). Every error this adapter returns goes
// through hideBrand, including upstream text that names its own site.

const errOf = (data: any, status: number, text: string) =>
  hideBrand(String(data?.error?.message || data?.message || data?.error || (text && text.slice(0, 200)) || `P10 HTTP ${status}`));

export async function p10CreateVideo(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
  refVideoUrl?: string;
}): Promise<P10CreateResult> {
  const { base, key } = await p10Config();
  if (!key) return { ok: false, error: "P10 key not configured", provider: "p10" };
  const kind = p10ModelFor(input.model);
  if (!kind) return { ok: false, error: `P10 serves only Omni 1.2 and Grok 1.5, not "${input.model}"`, provider: "p10" };
  if (input.refVideoUrl) return { ok: false, error: "P10 does not accept a reference video", provider: "p10" };

  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u.trim())).map((u) => u.trim());
  const mode = input.imageMode || (refs.length ? "ingredient" : "text");
  const aspect = input.aspectRatio === "16:9" ? "16:9" : "9:16";
  const reqDur = Math.round(Number(input.durationMode));
  const prompt = String(input.prompt || "").slice(0, 4000);

  let path: string;
  let body: Record<string, any>;
  if (kind === "omni") {
    path = "/v1/videos";
    body = {
      model: P10_OMNI_MODEL,
      prompt,
      duration: Number.isFinite(reqDur) && reqDur >= 4 && reqDur <= 15 ? reqDur : 15,
      resolution: "720p",
      aspect_ratio: aspect,
    };
    if (refs.length && mode === "frame") {
      body.first_image_url = refs[0];
      if (refs[1]) body.last_image_url = refs[1];
    } else if (refs.length && mode !== "text") {
      body.image_urls = refs.slice(0, 5);
    }
  } else {
    path = "/v1/videos/generations";
    body = {
      model: P10_GROK_MODEL,
      prompt,
      duration: Number.isFinite(reqDur) && reqDur >= 1 && reqDur <= 15 ? reqDur : 10,
      resolution: "720p",
      aspect_ratio: aspect,
    };
    if (refs.length && mode === "ingredient" && refs.length > 1) {
      body.video_generation_mode = "reference_images_to_video";
      body.reference_images = refs.slice(0, 7);
    } else if (refs.length && mode !== "text") {
      body.video_generation_mode = "first_frame_image_to_video";
      body.image = refs[0];
    } else {
      body.video_generation_mode = "text_to_video";
    }
  }

  // Up to 3 submits (owner's rule: ToAPIs three times, then the error). A create-time failure never reaches settle
  // (no task id), so the retries for it live here; a task that fails later is retried by settle on the p10 slots.
  let lastErr = "";
  let lastRaw: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { ok, status, data, text } = await p10Fetch("POST", base + path, key, body);
    const id = data?.id || data?.task_id || data?.data?.id;
    if (ok && id) return { ok: true, task_id: String(id), model: body.model, raw: data, provider: "p10" };
    lastErr = errOf(data, status, text);
    lastRaw = data;
    // Out of ToAPIs credit → retrying can't help; WhatsApp the admins now.
    const { isToapisOutOfCredit, alertToapisOutOfCredit } = await import("@/lib/toapis-balance");
    if (status === 402 || isToapisOutOfCredit(lastErr)) {
      await alertToapisOutOfCredit(lastErr);
      return { ok: false, error: `P10: ${lastErr}`, raw: lastRaw, provider: "p10" };
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return { ok: false, error: `P10: ${lastErr} (3 attempts)`, raw: lastRaw, provider: "p10" };
}

export async function p10GetStatus(taskId: string): Promise<P10StatusResult> {
  const { base, key } = await p10Config();
  if (!key) return { status: "pending", error: "P10 key not configured" };
  const id = encodeURIComponent(taskId);
  // /v1/tasks/{id} answers for every task type; /v1/videos/generations/{id} is the documented video path. Never
  // /v1/videos/{id} for a Grok task (false 501 "Generation failed").
  let res = await p10Fetch("GET", `${base}/v1/tasks/${id}`, key, undefined, 30_000);
  if (!res.data?.status) res = await p10Fetch("GET", `${base}/v1/videos/generations/${id}`, key, undefined, 30_000);
  const d = res.data;
  if (!d?.status) {
    // Network blip / unknown answer — stay pending so the next poll asks again (never fail a row on a glitch).
    return { status: "pending", error: errOf(d, res.status, res.text), raw: d };
  }
  const st = String(d.status).toLowerCase();
  if (st === "completed" || st === "succeeded" || st === "success") {
    const item = Array.isArray(d?.result?.data) ? d.result.data[0] : null;
    const url = item?.url || item?.fallback_url || d?.video_url || d?.url || "";
    if (!url) return { status: "failed", error: "P10 completed but returned no video url", raw: d };
    return { status: "succeeded", outputUrl: String(url), raw: d };
  }
  if (st === "failed" || st === "cancelled" || st === "canceled" || st === "error") {
    return { status: "failed", error: hideBrand(String(d?.error?.message || d?.error || d?.message || `P10 task ${st}`)), raw: d };
  }
  return { status: st === "in_progress" || st === "processing" || st === "running" ? "running" : "pending", raw: d };
}
