// What the "Check Guideline TikTok" guard did on a finished Motion job, from
// history.metadata.guard — shared by /api/motion/status and the History card.
// Pure (no server imports) so client components can use it.

export type MotionGuardSummary = {
  taped: number;
  cut: number;
  muted: number;
  risk: { level: string; reason: string } | null;
};

export function motionGuardSummary(g: unknown): MotionGuardSummary | null {
  if (!g || typeof g !== "object") return null;
  const x = g as any;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    taped: n(x.tapes) + n(x.broll?.taped) + n(x.taped),
    cut: n(x.cut_words),
    muted: n(x.muted_words),
    risk: x.risk && typeof x.risk === "object" ? { level: String(x.risk.level || ""), reason: String(x.risk.reason || "").slice(0, 220) } : null,
  };
}
