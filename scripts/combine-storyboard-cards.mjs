// Combine the 3 exported page files into ONE organized markdown doc:
// Part A (global rules, once) → UGC sub-styles (all pages) → Product Commercial
// sub-styles (all pages). Run AFTER export-storyboard-cards.mjs.
// Output: storyboard-cards-export/ALL-storyboard-cards.md
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "storyboard-cards-export";
const PAGES = [
  { file: "page1-proven.md", label: "Page 1 — Proven" },
  { file: "page2.md", label: "Page 2" },
  { file: "page3.md", label: "Page 3" },
];

// Split a page's PART B into individual "### N. Name" cards (verbatim).
function cardsOf(text) {
  const b = text.indexOf("## PART B");
  const body = b >= 0 ? text.slice(b).replace(/^## PART B[^\n]*\n/, "") : text;
  return body
    .split(/\n(?=### \d+\.\s)/)
    .map((c) => c.trim())
    .filter((c) => /^### \d+\.\s/.test(c));
}

const first = readFileSync(`${DIR}/${PAGES[0].file}`, "utf8");
// Part A = global rules (identical across pages per the spec) — take page 1's.
const a = first.indexOf("## PART A");
const bIdx = first.indexOf("## PART B");
const partA = a >= 0 && bIdx > a ? first.slice(a, bIdx).trim() : "";

const ugc = []; // { label, cards[] }
const pc = [];
for (const p of PAGES) {
  const cards = cardsOf(readFileSync(`${DIR}/${p.file}`, "utf8"));
  // Per confirmed order every page is UGC 1..14 then Product Commercial 15..26.
  ugc.push({ label: p.label, cards: cards.slice(0, 14) });
  pc.push({ label: p.label, cards: cards.slice(14) });
}

const section = (title, groups) =>
  `\n# ${title}\n\n` +
  groups
    .map((g) => `## ${g.label}\n\n${g.cards.join("\n\n---\n\n")}`)
    .join("\n\n");

const ugcCount = ugc.reduce((n, g) => n + g.cards.length, 0);
const pcCount = pc.reduce((n, g) => n + g.cards.length, 0);

const out =
  `# PeningLab — Storyboard Sub-Category FULL SPEC (All Pages, Single File)\n\n` +
  `**What this is:** the complete execution playbook for PeningLab's Storyboard mode — ` +
  `enough for ANY AI to read the global rules + one sub-category card and produce a 100%-correct ` +
  `9:16 storyboard grid image (6–9 panels) for that style.\n\n` +
  `**Structure:** 3 MAIN modes — **UGC** (realistic, phone-shot), **Product Commercial** (premium, cinematic), ` +
  `and **Custom Idea** (client's own concept). Below: the shared **Global Rules (Part A)**, then every **UGC** ` +
  `sub-style (${ugcCount}), then every **Product Commercial** sub-style (${pcCount}) — grouped by page ` +
  `(Page 1 = proven set; Pages 2 & 3 = extra variety sets, same rules).\n\n` +
  `**How to use:** pick a sub-style → give an AI *Part A + that one card* → it writes the image prompt.\n\n` +
  `---\n\n${partA}\n\n` +
  section(`UGC SUB-STYLES (${ugcCount})`, ugc) +
  `\n\n` +
  section(`PRODUCT COMMERCIAL SUB-STYLES (${pcCount})`, pc) +
  `\n`;

writeFileSync(`${DIR}/ALL-storyboard-cards.md`, out, "utf8");
console.log(`✓ ALL-storyboard-cards.md — ${out.length.toLocaleString()} chars · UGC ${ugcCount} · PC ${pcCount}`);
