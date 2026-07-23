// Loads the confidential 26 sub-category execution spec (stored in
// app_settings.storyboard_subcards, kept OUT of git) and slices out the
// global rules (Part A) + one specific sub card so the storyboard prompt
// planner gets the EXACT signature / beats / frame-by-frame guidance for the
// chosen sub — not a generic description.

import { getSettings } from "@/lib/settings";

// Page-aware spec loader. Page 1 (default) is the PROVEN spec in
// `storyboard_subcards` — its key, content and behaviour are never touched.
// Pages 2 & 3 are EXTRA variety sets stored in separate keys, so page 1 is
// impossible to disturb. An unset page-2/3 key returns "" → the route falls
// back to its generic prompt for that sub, exactly like a missing card today.
export type SubPage = 1 | 2 | 3;

export function subcardsKey(page: SubPage): string {
  return page === 2 ? "storyboard_subcards_p2" : page === 3 ? "storyboard_subcards_p3" : "storyboard_subcards";
}

export async function loadSubCards(page: SubPage = 1): Promise<string> {
  const key = subcardsKey(page);
  const s = await getSettings([key]);
  const text = (s as Record<string, { text?: string } | undefined>)[key]?.text;
  return typeof text === "string" ? text : "";
}

// Part A — the global rules every sub obeys (menu, grid standard, anti-collage,
// identity anchor, talent, neutral framing, word budget, claim safety, recipe).
export function extractGlobalRules(text: string): string {
  const a = text.indexOf("## PART A");
  const b = text.indexOf("## PART B");
  if (a >= 0 && b > a) return text.slice(a, b).trim();
  return "";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // drop parentheticals: "Talking Head (edukasi)" → "Talking Head"
    .replace(/\s*\/\s*/g, "/") // "Before / After" → "Before/After"
    .replace(/\s*→\s*/g, "→") // "Masalah → Solusi" → "Masalah→Solusi"
    .replace(/\s+/g, " ")
    .trim();

// The full card for one sub ("### N. Name" … up to the next card / separator),
// matched tolerantly against the UI's sub label.
export function extractSubCard(text: string, subName: string): string {
  const b = text.indexOf("## PART B");
  const body = b >= 0 ? text.slice(b) : text;
  const target = norm(subName);
  const parts = body.split(/\n(?=### \d+\.\s)/);
  for (const p of parts) {
    const m = p.match(/^### \d+\.\s*(.+)/);
    if (!m) continue;
    const h = norm(m[1]);
    // Exact, or the card has a slash-alias the label omits ("Lifestyle / Daily"
    // → "lifestyle/daily" matches label "lifestyle"). The "+ '/'" guard keeps
    // space-separated names distinct (so "unboxing" ≠ "unboxing asmr").
    if (h === target || h.startsWith(target + "/") || target.startsWith(h + "/")) {
      return p.split(/\n---\n/)[0].trim();
    }
  }
  return "";
}
