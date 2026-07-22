// intro-video.ts — synchronous image-to-video for the Editor's Frame intro.
// The cover is the START FRAME; the prompt is built from the cover headline +
// subtext. Submits through the GROK cascade, then polls the resolved
// provider/slot until the clip is ready (there is no settle/cron wired for
// editor-framed rows, so we poll inline).
//
// CASCADE (per user direction 2026-07-22): this honours the admin's Grok
// cascade exactly — MAIN slots first, then FALLBACK slots. That needs an
// explicit walk here because generateVideoWithCascade is SINGLE-SHOT: it picks
// ONE slot by round-robin and never advances, so a dead main would otherwise
// fail the frame outright with the fallback row never touched.
//
// Duration note: Crun's grok-imagine-video-1.5-preview accepts 1-15s (verified:
// a 4s request returned a 4.04s 720x1280 clip). But APIPod sometimes reroutes
// to "grok-imagine-video-1.5-fast", which rejects under 6s with
// '"video_length" must be between 6 and 30' — so on that specific error we
// retry the same slot at 6s rather than failing.

import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getGrokMainSlots, getGrokFallbackSlots, type SlotProvider } from "@/lib/cascade-rotation";
import { getP2Config } from "@/lib/settings";
import { p2GetStatus } from "@/lib/p2";
import { p6GetStatus, type P6Slot } from "@/lib/p6";

/** APIPod's fallback Grok backend rejects clips under 6s. */
const MIN_DUR_REJECTION = /video_length[^\n]*between\s*6\s*and\s*30|between\s*6\s*and\s*30/i;

export async function generateIntroVideo(opts: {
  coverUrl: string;
  prompt: string;
  durationSec: number;
  userId?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; url?: string; error?: string; usedDurationSec?: number; slot?: string }> {
  const { coverUrl, prompt, durationSec, userId } = opts;
  const timeoutMs = opts.timeoutMs ?? 210_000;
  if (!coverUrl) return { ok: false, error: "Missing cover" };

  const cfg = await getP2Config();
  const grokModel = cfg.grokI2V || "grok";

  // MAIN slots then FALLBACK slots, in the admin's configured order, deduped
  // and with "none" stripped.
  const [mains, fbs] = await Promise.all([getGrokMainSlots(), getGrokFallbackSlots()]);
  const seen = new Set<SlotProvider>();
  const order: SlotProvider[] = [...mains, ...fbs].filter((s) => {
    if (s === "none" || seen.has(s)) return false;
    seen.add(s);
    return true;
  });
  if (!order.length) return { ok: false, error: "Tiada slot Grok dikonfigur (admin → Grok cascade)" };

  const submit = (slot: SlotProvider, secs: number) =>
    generateVideoWithCascade({
      primaryModel: grokModel,
      prompt,
      imageUrls: [coverUrl],
      imageMode: "frame",     // i2v — cover is the start frame
      aspectRatio: "9:16",
      durationMode: String(secs),
      asset: "grok",
      forceSlot: slot,        // drive the walk ourselves
      userId,
    });

  const errors: string[] = [];
  for (const slot of order) {
    let secs = Math.max(1, Math.min(15, Math.round(durationSec)));
    let sub = await submit(slot, secs);
    // Rerouted to the 6-30s backend → retry the SAME slot at 6s.
    if (!sub.ok && secs < 6 && MIN_DUR_REJECTION.test(String(sub.error || ""))) {
      secs = 6;
      sub = await submit(slot, secs);
    }
    if (!sub.ok) {
      errors.push(`${slot}: ${sub.error || "submit gagal"}`);
      continue; // next slot in the cascade
    }

    const taskId = sub.taskId;
    const actualSlot = sub.actualSlot || slot;
    const provider = sub.actualProvider;
    const isP6 = String(actualSlot || provider || "").startsWith("p6");

    const startedAt = Date.now();
    let pollErr = "";
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        let status = "pending";
        let outputUrl: string | undefined;
        let err: string | undefined;
        if (isP6) {
          const s = await p6GetStatus(taskId, actualSlot as P6Slot, "video");
          status = s.status; outputUrl = s.outputUrl; err = s.error;
        } else {
          // Crun scopes tasks to the key that created them — the p2-b slot uses
          // the secondary key (app_settings.p2_key_b), so polling with the
          // default p2_key would never find the task.
          const keyOverride = actualSlot === "p2-b" ? (cfg.keyB || undefined) : undefined;
          const s = await p2GetStatus(taskId, provider === "p1" ? "p1" : "p2", keyOverride);
          status = s.status; outputUrl = s.outputUrl; err = s.error;
        }
        if (status === "succeeded" && outputUrl) {
          return { ok: true, url: outputUrl, usedDurationSec: secs, slot: String(actualSlot) };
        }
        if (status === "failed") { pollErr = err || "task gagal"; break; }
      } catch {
        /* transient poll error — keep polling */
      }
    }
    errors.push(`${actualSlot}: ${pollErr || `pending > ${Math.round(timeoutMs / 1000)}s`}`);
    // Generation failed on this slot — fall through to the next cascade slot.
  }

  return { ok: false, error: errors.join("; ") || "Semua slot Grok gagal" };
}
