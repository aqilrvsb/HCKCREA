// Hardcoded language rule for Seedance 2.0 videos (storyboard→video AND the
// Original Video Seedance tab). Seedance's own voiceover tends to drift into
// Indonesian; per user direction we STRIP Indonesian only — the model is free
// to pick Malaysian Malay OR English (dynamic, whichever fits the scene), it
// just may never speak/caption Indonesian.
//
// This is a PROMPT rule only. It does NOT touch cascade/fallback routing —
// Seedance still flows through its dynamic seedance cascade pool.
export const SEEDANCE_NO_INDON =
  "LANGUAGE (STRICT): every spoken voiceover word and every on-screen caption must be Malaysian Malay (Bahasa Melayu Malaysia) OR English — pick whichever fits the scene, but NEVER Indonesian. " +
  "Do not use any Indonesian words, Indonesian slang, or Indonesian verb/spelling forms (e.g. banget, nih, yuk, gua, lo, bikin, kayak, udah, aja, dong, sih, gede, kenapa sih, nggak). " +
  "Malaysian spelling and Malaysian pronunciation only.";

// Append the rule to a prompt exactly once (idempotent — Resubmit re-reads the
// stored prompt, so we must never stack the clause on repeated fires).
export function withNoIndon(prompt: string): string {
  const p = (prompt || "").trim();
  if (p.includes("LANGUAGE (STRICT): every spoken voiceover")) return p;
  return `${p} ${SEEDANCE_NO_INDON}`.trim();
}
