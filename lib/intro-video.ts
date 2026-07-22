// intro-video.ts — synchronous image-to-video for the Editor's Frame intro.
// The cover is the SOURCE IMAGE; the prompt is built from the cover headline +
// subtext. Submits through the cascade, then polls the resolved provider/slot
// until the clip is ready (there is no settle/cron wired for editor-framed
// rows, so we poll inline).
//
// Model: Wan 2.7 i2v (replaced Grok Imagine 2026-07-22). Reasons, all verified
// against the live API:
//   • honours SHORT durations — a 3s request returned a 3.00s clip, while
//     Grok's rerouted backend ("grok-imagine-video-1.5-fast") 400s under 6s
//   • inherits the input image's aspect ratio — a 1440x2560 cover produced a
//     native 720x1280 (true 9:16) clip, which is what Frame needs
//   • doesn't depend on APIPod's Grok/"TT API" balance, which ran dry

import { generateVideoWithCascade } from "@/lib/video-cascade";
import { p2GetStatus } from "@/lib/p2";
import { p6GetStatus, type P6Slot } from "@/lib/p6";

export async function generateIntroVideo(opts: {
  coverUrl: string;
  prompt: string;
  durationSec: number;
  userId?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; url?: string; error?: string; usedDurationSec?: number }> {
  const { coverUrl, prompt, durationSec, userId } = opts;
  const timeoutMs = opts.timeoutMs ?? 210_000;
  if (!coverUrl) return { ok: false, error: "Missing cover" };

  const usedDuration = Math.max(1, Math.min(10, Math.round(durationSec)));

  // Submit through the cascade — it picks a working slot + key and returns the
  // taskId plus the provider/slot that accepted it (needed to poll).
  // asset:"grok" keeps the existing p6-a/p6-b slot pool (same provider).
  const sub = await generateVideoWithCascade({
    primaryModel: "wan2.7-i2v",
    prompt,
    imageUrls: [coverUrl],
    imageMode: "frame",       // i2v — cover is the source image
    aspectRatio: "9:16",      // dropped by the wan branch; output follows the cover
    durationMode: String(usedDuration),
    asset: "grok",
    userId,
  });
  if (!sub.ok) return { ok: false, error: sub.error || "Intro submit gagal" };

  const taskId = sub.taskId;
  const slot = sub.actualSlot;                 // e.g. "p6-a" | "p2-a"
  const provider = sub.actualProvider;         // "p6" | "p2" | "p1" | …
  const isP6 = String(slot || provider || "").startsWith("p6");

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      let status = "pending";
      let outputUrl: string | undefined;
      let err: string | undefined;
      if (isP6) {
        const s = await p6GetStatus(taskId, slot as P6Slot, "video");
        status = s.status; outputUrl = s.outputUrl; err = s.error;
      } else {
        const s = await p2GetStatus(taskId, provider === "p1" ? "p1" : "p2");
        status = s.status; outputUrl = s.outputUrl; err = s.error;
      }
      if (status === "succeeded" && outputUrl) return { ok: true, url: outputUrl, usedDurationSec: usedDuration };
      if (status === "failed") return { ok: false, error: err || "Intro task gagal" };
    } catch {
      /* transient poll error — keep polling */
    }
  }
  return { ok: false, error: `Intro masih pending selepas ${Math.round(timeoutMs / 1000)}s` };
}
