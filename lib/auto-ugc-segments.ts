// Auto UGC segment math — shared by the tab UI (preview) and the
// /api/generate/auto-ugc route (actual orchestration) so both agree on how a
// requested duration splits into Grok-Imagine clips.
//
// Rule (per user direction): Grok Imagine 1.5 caps at 15s/clip, so a long
// request is split into BALANCED HALVES, each ≤15s:
//   ≤15s  → 1 segment  [total]
//   16-30s → 2 segments [ceil(total/2), floor(total/2)]  (20→10+10, 30→15+15, 25→13+12)
// Total is clamped to [4, 30].

export const AUTO_UGC_MIN_SEC = 4;
export const AUTO_UGC_MAX_SEC = 30;
export const GROK_MAX_CLIP_SEC = 15;

/** Split a requested total duration (seconds) into balanced segment lengths. */
export function splitDuration(totalSec: number): number[] {
  const total = Math.max(
    AUTO_UGC_MIN_SEC,
    Math.min(AUTO_UGC_MAX_SEC, Math.round(totalSec || 0))
  );
  if (total <= GROK_MAX_CLIP_SEC) return [total];
  const a = Math.min(GROK_MAX_CLIP_SEC, Math.ceil(total / 2));
  const b = total - a;
  return [a, b];
}

/**
 * Seller/TikTok dialog word-count target for a given clip length, matching
 * the on-screen planner table (8s→20-24 … 15s→35-40). Returns an inclusive
 * [min,max] range so the script LLM can pace the continuous dialog.
 */
export function sellerWordTarget(sec: number): { min: number; max: number } {
  const s = Math.max(AUTO_UGC_MIN_SEC, Math.min(GROK_MAX_CLIP_SEC, Math.round(sec || 0)));
  // Calibrated to the planner: ~2.4×–2.7× seconds, rounded to tidy values.
  const min = Math.round(s * 2.4);
  const max = Math.round(s * 2.7) + 1;
  return { min, max };
}

/** Human label for the split, e.g. "1 video (15s)" or "2 segmen (15s + 15s)". */
export function splitLabel(totalSec: number): string {
  const segs = splitDuration(totalSec);
  if (segs.length === 1) return `1 video (${segs[0]}s)`;
  return `${segs.length} segmen (${segs.join("s + ")}s)`;
}
