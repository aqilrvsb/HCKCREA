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
