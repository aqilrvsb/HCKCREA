// Loads the confidential 26 sub-category execution spec (stored in
// app_settings.storyboard_subcards, kept OUT of git) and slices out the
// global rules (Part A) + one specific sub card so the storyboard prompt
// planner gets the EXACT signature / beats / frame-by-frame guidance for the
// chosen sub — not a generic description.

import { getSettings } from "@/lib/settings";

export async function loadSubCards(): Promise<string> {
  const s = await getSettings(["storyboard_subcards"]);
  const text = s.storyboard_subcards?.text;
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
