// fal.ai helpers — frame extract, video merge, image upscale.
// All keys/paths read from app_settings via lib/settings.ts so admin can
// rotate without a redeploy.
//
// Port of creative-hack-auto/background.js apiExtractFrame — same contract:
//   POST {fal_base}{fal_extract_path}
//   Authorization: Key <fal_key>
//   body: { video_url, frame_type: "first" | "last" }
//   resp: { images: [{ url }] }
//
// Synchronous endpoint (~3s). Returns the JPG URL or null on failure.

import { getSettings } from "@/lib/settings";

export async function falExtractFrame(
  videoUrl: string,
  frameType: "first" | "last" = "last"
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!videoUrl) return { ok: false, error: "Missing video URL" };

  const s = await getSettings(["fal_base", "fal_key", "fal_extract_path"]);
  const base = s.fal_base?.url;
  const key = s.fal_key?.key;
  const path = s.fal_extract_path?.path;
  if (!base || !key || !path) return { ok: false, error: "fal.ai not configured" };

  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${key}`,
      },
      body: JSON.stringify({ video_url: videoUrl, frame_type: frameType }),
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
