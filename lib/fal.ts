// fal.ai helpers — frame extract (first/middle/last), video merge.
// All keys/paths read from app_settings via lib/settings.ts so admin can
// rotate without a redeploy.

import { getSettings } from "@/lib/settings";

export type FrameAnchor = "first" | "middle" | "last";

// ──────────────────────────────────────────────────────────────────────────
// falExtractFrame — extract a frame at first / middle / last anchor.
//
// fal's extract-frame endpoint accepts frame_type ∈ {first, last}. For
// "middle" we send timestamp_sec=clipDuration/2 (defaults to 4.0 if duration
// unknown — middle of an 8s clip).
//
// Synchronous (~3s). Returns the JPG URL or error.
// ──────────────────────────────────────────────────────────────────────────

export async function falExtractFrame(
  videoUrl: string,
  frameAnchor: FrameAnchor = "last",
  clipDurationSec?: number
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!videoUrl) return { ok: false, error: "Missing video URL" };

  const s = await getSettings(["fal_base", "fal_key", "fal_extract_path"]);
  const base = s.fal_base?.url;
  const key = s.fal_key?.key;
  const path = s.fal_extract_path?.path;
  if (!base || !key || !path) return { ok: false, error: "fal.ai not configured" };

  // Build body — middle uses timestamp_sec, first/last use frame_type
  const body: Record<string, any> = { video_url: videoUrl };
  if (frameAnchor === "middle") {
    const t = clipDurationSec ? clipDurationSec / 2 : 4.0;
    body.timestamp_sec = Number(t.toFixed(2));
    // Some fal versions also accept frame_type:"middle" — send both for safety
    body.frame_type = "middle";
  } else {
    body.frame_type = frameAnchor;
  }

  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Frame extract HTTP ${res.status}: ${text.substring(0, 200)}`,
      };
    }
    const data = await res.json().catch(() => null);
    const url = data?.images?.[0]?.url;
    if (!url || typeof url !== "string") {
      return { ok: false, error: "Frame extract returned no URL" };
    }
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Frame extract network error" };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// falMergeVideos — server-side ffmpeg concat via fal.
// Synchronous endpoint (~16s for 2 clips). Returns the merged video URL.
// ──────────────────────────────────────────────────────────────────────────

export async function falMergeVideos(
  videoUrls: string[]
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!videoUrls || videoUrls.length < 2) {
    return { ok: false, error: "Need at least 2 video URLs to merge" };
  }
  const s = await getSettings(["fal_base", "fal_key", "fal_merge_path"]);
  const base = s.fal_base?.url;
  const key = s.fal_key?.key;
  const path = s.fal_merge_path?.path;
  if (!base || !key || !path) return { ok: false, error: "fal merge not configured" };

  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${key}`,
      },
      body: JSON.stringify({ video_urls: videoUrls }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Merge HTTP ${res.status}: ${text.substring(0, 200)}`,
      };
    }
    const data = await res.json().catch(() => null);
    const url = data?.video?.url || data?.url || data?.merged_video?.url;
    if (!url || typeof url !== "string") {
      return { ok: false, error: "Merge returned no URL" };
    }
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Merge network error" };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// falRemoveBackground — Bria RMBG 2.0 image background removal.
//
// `imageInput` can be a public URL OR a base64 data URI (so callers can run
// bg-removal BEFORE storing the file anywhere). Returns a fal-hosted
// transparent PNG URL. Uses the queue API + short poll (bria image is fast,
// usually a few seconds). fal_key read from app_settings.
// ──────────────────────────────────────────────────────────────────────────

export async function falRemoveBackground(
  imageInput: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!imageInput) return { ok: false, error: "Missing image" };
  const s = await getSettings(["fal_key"]);
  const key = s.fal_key?.key;
  if (!key) return { ok: false, error: "fal.ai not configured" };

  const MODEL = "fal-ai/bria/background/remove";
  const H = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

  try {
    const sub = await fetch(`https://queue.fal.run/${MODEL}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ image_url: imageInput }),
    });
    const subJson: any = await sub.json().catch(() => ({}));
    const reqId = subJson?.request_id;
    if (!reqId) {
      return { ok: false, error: `fal submit HTTP ${sub.status}: ${JSON.stringify(subJson).slice(0, 200)}` };
    }

    // IMPORTANT: poll the URLs fal returns — the queue base is the APP
    // namespace (fal-ai/bria/requests/<id>), NOT the full model path
    // (fal-ai/bria/background/remove/requests/<id>, which 404s).
    const statusUrl = subJson?.status_url || `https://queue.fal.run/fal-ai/bria/requests/${reqId}/status`;
    const resUrl = subJson?.response_url || `https://queue.fal.run/fal-ai/bria/requests/${reqId}`;
    const t0 = Date.now();
    while (Date.now() - t0 < 50_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const st: any = await (await fetch(statusUrl, { headers: H })).json().catch(() => ({}));
      if (st?.status === "COMPLETED") {
        const out: any = await (await fetch(resUrl, { headers: H })).json().catch(() => ({}));
        const url = out?.image?.url || out?.images?.[0]?.url;
        if (url && typeof url === "string") return { ok: true, url };
        return { ok: false, error: "fal returned no image URL" };
      }
      if (st?.status === "FAILED" || st?.status === "ERROR") {
        return { ok: false, error: "fal bg-removal failed" };
      }
    }
    return { ok: false, error: "fal bg-removal timeout" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "fal network error" };
  }
}
