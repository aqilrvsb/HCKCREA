// PixelByte (api.muvi.video) — the "p7" provider. A Seedance 2.0 mini gateway
// that runs WITHOUT ByteDance's "may contain real person" face filter, so our
// AI-face storyboards actually pass. Seedance-only.
//
// Auth: Bearer key stored in app_settings.p7_key = { "key": "..." }.
// Base: https://api.muvi.video
//   POST /v1/jobs/submit    — submit a job → { jobId, status, ... } (sometimes wrapped in { data })
//   GET  /v1/jobs/{jobId}   — poll status  → { status, output, outputs, error } (sometimes wrapped in { data })

import { getSettings } from "@/lib/settings";

const P7_BASE = "https://api.muvi.video";

export type P7CreateResult =
  | { ok: true; task_id: string; model: string; raw: any; provider: "p7" }
  | { ok: false; error: string; raw?: any; provider: "p7" };

export type P7StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

export async function getP7Key(): Promise<string> {
  const s = await getSettings(["p7_key"]);
  return String((s as any)["p7_key"]?.key || "").trim();
}

// PixelByte returns some payloads flat and some wrapped in { success, data,
// requestId }. Normalise: prefer .data when present, else the object itself.
function unwrap(json: any): any {
  return json && typeof json === "object" && json.data && typeof json.data === "object" ? json.data : json;
}

// Seedance 2.0 mini slug — reference-to-video when refs are present, else t2v.
function p7Model(refCount: number): string {
  return refCount > 0
    ? "bytedance/seedance-2.0-mini/reference-to-video"
    : "bytedance/seedance-2.0-mini/text-to-video";
}

export async function p7CreateVideo(input: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  durationMode?: string | number;
}): Promise<P7CreateResult> {
  const apiKey = await getP7Key();
  if (!apiKey) return { ok: false, error: "p7_key not configured", provider: "p7" };

  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const modelSlug = p7Model(refs.length);

  const ar = ["9:16", "16:9", "1:1", "3:4", "4:3", "21:9"].includes(String(input.aspectRatio))
    ? String(input.aspectRatio)
    : "9:16";
  const reqDur = Number(input.durationMode);
  const duration = Number.isFinite(reqDur) && reqDur >= 4 && reqDur <= 15 ? Math.round(reqDur) : 10;

  const modelInput: any = {
    prompt: (input.prompt || "").slice(0, 4000),
    aspect_ratio: ar,
    // Seedance 2.0 fixed at 480p per user direction (cheaper/faster).
    resolution: "480p",
    duration,
    has_sound: true,
  };
  if (refs.length > 0) modelInput.reference_urls = refs.slice(0, 9);

  let r: Response;
  try {
    r = await fetch(P7_BASE + "/v1/jobs/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSlug, input: modelInput }),
    });
  } catch (e: any) {
    return { ok: false, error: `PixelByte network error: ${e?.message || "fetch failed"}`, provider: "p7" };
  }
  const json = await r.json().catch(() => ({}));
  const d = unwrap(json);
  if (!r.ok || d?.error) {
    const err = d?.error?.message || d?.error?.code || d?.message || d?.error || `PixelByte HTTP ${r.status}`;
    return { ok: false, error: String(err), raw: json, provider: "p7" };
  }
  const taskId = d?.jobId || d?.job_id || d?.id;
  if (!taskId) return { ok: false, error: "PixelByte returned no jobId", raw: json, provider: "p7" };
  // model string carries "seedance" so inferModelHint() bills it per-second.
  return { ok: true, task_id: String(taskId), model: "seedance-2.0-mini-r2v", raw: json, provider: "p7" };
}

export async function p7GetStatus(taskId: string): Promise<P7StatusResult> {
  const apiKey = await getP7Key();
  if (!apiKey) return { status: "pending", error: "p7_key not configured" };

  let r: Response;
  try {
    r = await fetch(P7_BASE + "/v1/jobs/" + encodeURIComponent(taskId), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e: any) {
    return { status: "pending", error: `PixelByte network error: ${e?.message || "fetch failed"}` };
  }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { status: "pending", error: `PixelByte HTTP ${r.status}`, raw: json };

  const d = unwrap(json);
  const st = String(d?.status || "").toLowerCase();
  if (st === "completed") {
    const url =
      (typeof d?.output === "string" ? d.output : "") ||
      (Array.isArray(d?.outputs) ? d.outputs[0]?.url : "") ||
      "";
    if (!url) return { status: "failed", error: "PixelByte completed but returned no output url", raw: json };
    return { status: "succeeded", outputUrl: String(url), raw: json };
  }
  if (st === "failed" || st === "cancelled") {
    return { status: "failed", error: d?.error?.message || `PixelByte job ${st}`, raw: json };
  }
  return { status: st === "processing" ? "running" : "pending", raw: json };
}
