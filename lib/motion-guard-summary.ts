// What the "Check Guideline TikTok" guard did on a finished Motion job, from
// history.metadata.guard — shared by /api/motion/status and the History card.
// Pure (no server imports) so client components can use it.

export type MotionGuardSummary = {
  taped: number;
  cut: number;
  muted: number;
  risk: { level: string; reason: string } | null;
  /** Printed text that got taped: on the video's packaging, B-roll photos, final check. */
  tapedTexts: string[];
  /** B-roll photos taped whose text wasn't recorded (jobs before the text list). */
  tapedImagesUnlisted: number;
  /** The claim sentence(s) cut out of the speech. */
  cutText: string;
  /** Words muted in the audio and covered in the captions. */
  mutedWords: string[];
};

// history.metadata.guard as Modal writes it (every field optional / untrusted).
type RawGuard = {
  tapes?: unknown; taped?: unknown; cut_words?: unknown; muted_words?: unknown; cut?: unknown; muted?: unknown;
  risky_texts?: unknown; risk?: { level?: unknown; reason?: unknown } | null;
  broll?: { taped?: unknown; texts?: unknown }; final_qa?: { leak_texts?: unknown };
};

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : [];

export function motionGuardSummary(g: unknown): MotionGuardSummary | null {
  if (!g || typeof g !== "object") return null;
  const x = g as RawGuard;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const seen = new Set<string>();
  const tapedTexts = [...list(x.risky_texts), ...list(x.broll?.texts), ...list(x.final_qa?.leak_texts)]
    .filter((t) => {
      const k = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return {
    taped: n(x.tapes) + n(x.broll?.taped) + n(x.taped),
    cut: n(x.cut_words),
    muted: n(x.muted_words),
    risk: x.risk && typeof x.risk === "object" ? { level: String(x.risk.level || ""), reason: String(x.risk.reason || "").slice(0, 220) } : null,
    tapedTexts,
    tapedImagesUnlisted: Array.isArray(x.broll?.texts) ? 0 : n(x.broll?.taped),
    cutText: String(x.cut ?? "").replace(/\s+/g, " ").trim(),
    mutedWords: [...new Set(list(x.muted).map((w) => w.replace(/[.,!?;:]+$/, "")))],
  };
}
