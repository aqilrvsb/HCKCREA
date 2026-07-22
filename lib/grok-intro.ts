// grok-intro.ts — synchronous Grok Imagine 1.5 image-to-video for the Editor's
// Frame → Grok mode. The cover is the START FRAME; the prompt is built from the
// cover headline + subtext. Submits through the grok cascade, then polls the
// resolved provider/slot until the clip is ready (there is no settle/cron wired
// for editor-framed rows, so we poll inline).

import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getP2Config } from "@/lib/settings";
import { p2GetStatus } from "@/lib/p2";
import { p6GetStatus, type P6Slot } from "@/lib/p6";

/** APIPod's fallback Grok backend ("grok-imagine-video-1.5-fast") rejects
 *  clips under 6s: '"video_length" must be between 6 and 30'. Their primary
 *  (grok-imagine-1.5-preview) happily makes 3-5s clips, so we only lengthen
 *  when we actually see this rejection. */
const MIN_DUR_REJECTION = /video_length.*between\s*6\s*and\s*30|between\s*6\s*and\s*30/i;

export async function generateGrokIntro(opts: {
  coverUrl: string;
  prompt: string;
  durationSec: number;
  userId?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; url?: string; error?: string; usedDurationSec?: number }> {
  const { coverUrl, prompt, durationSec, userId } = opts;
  const timeoutMs = opts.timeoutMs ?? 210_000;
  if (!coverUrl) return { ok: false, error: "Missing cover" };

  const cfg = await getP2Config();
  const grokModel = cfg.grokI2V || "grok";

  const submit = (secs: number) =>
    generateVideoWithCascade({
      primaryModel: grokModel,
      prompt,
      imageUrls: [coverUrl],
      imageMode: "frame",       // i2v — cover is the start frame
      aspectRatio: "9:16",
      durationMode: String(Math.max(1, Math.min(30, Math.round(secs)))),
      asset: "grok",
      userId,
    });

  // Submit through the grok cascade — it picks a working slot + key and returns
  // the taskId plus the provider/slot that accepted it (needed to poll).
  let usedDuration = Math.max(1, Math.min(30, Math.round(durationSec)));
  let sub = await submit(usedDuration);
  // Rerouted to the 6-30 backend → retry once at 6s instead of failing.
  if (!sub.ok && usedDuration < 6 && MIN_DUR_REJECTION.test(String(sub.error || ""))) {
    usedDuration = 6;
    sub = await submit(usedDuration);
  }
  if (!sub.ok) return { ok: false, error: sub.error || "Grok submit gagal" };

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
      if (status === "failed") return { ok: false, error: err || "Grok task gagal" };
    } catch {
      /* transient poll error — keep polling */
    }
  }
  return { ok: false, error: `Grok masih pending selepas ${Math.round(timeoutMs / 1000)}s` };
}
