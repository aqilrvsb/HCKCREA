import type { Skill } from "../../types";

export const hookComparison: Skill = {
  id: "comparison",
  kind: "hook",
  tab: "ugc",
  title: "Comparison Hook (Price or Value Anchor)",
  triggers: ["comparison", "vs", "versus", "price", "value", "cheap vs expensive", "better", "RM", "mana lagi", "worth it"],
  body: `# Comparison Hook

**Pattern:** "RM400 vs RM49 — mana lagi best?" — anchors a high-price reference against a low-price hero, or compares two options viewers already know. Locks in watch time via unresolved verdict.
**Why it works:** Anchoring effect — brain evaluates RM49 relative to RM400, not absolute value. Unresolved comparison is a cliffhanger that forces completion. Works for both value-positioning and premium-positioning categories.

## Hook phrase library (verified active 2025-26)
1. "Skincare RM400 vs RM49 — aku test 30 hari. Result dia buat aku terkejut."
2. "Mall brand vs TikTok Shop — honest review. Mana selamat?"
3. "Aku beli dua version: original RM200 vs dupe RM35. Beza dia?"
4. "Klinik laser RM800 vs serum RM60 yang orang tengah viral. Aku test dua-dua."
5. "Yang mahal ke yang murah yang betul-betul kerja? Aku dah test untuk korang."
6. "Collagen farmasi vs collagen viral TikTok — ingredient list dia beza gila."
7. "RM10 sunscreen vs RM120 sunscreen — perlindungan UV dia sama ke?"
8. "Beli kat Guardian vs beli online — beza kualiti ke atau beza packaging je?"
9. "Before produk ni: RM500/month kat klinik. After: RM79/month. Math dia senang."

## Beat math (first 2s only)
- Word count: 7-11 words — state both options by second 1.5, withhold verdict
- Delivery: punch the price numbers clearly; rising inflection on "mana lagi best?"
- Visual: split-screen or hold two products up; price text overlays on each side

## Structural rules
- ALWAYS withhold the verdict until mid-video or end — comparison hook only works as cliffhanger
- ALWAYS make one option familiar/expected (the expensive/popular one) vs the surprise option
- NEVER reveal winner in hook — that's the entire reason to watch
- For price comparison: hero product MUST be the lower-priced one (value frame) unless premium positioning

## Pairs best with
- Frameworks: BAB-Extended (Before=expensive, After=hero), MBT (Myth=expensive is better), PRP
- Personas: Skeptic-Converted, Educational Expert, Casual Bestie
- Scenes: Product side-by-side, Bathroom shelf, Ingredient close-up

## Pitfalls
- AVOID naming specific brand competitors directly (TikTok ad policy risk)
- AVOID fake comparisons where difference is obvious — kills credibility
- AVOID comparing incomparable things ("RM10 drugstore vs RM500 medical-grade")
- AVOID resolving too fast — comparison hooks need at least 8s to pay off

## Veo prompt insertion
Split-screen or two-product shot in first frame. Example:
"She holds two products side by side, says: 'Skincare RM400 vs RM49 — aku test 30 hari. Result dia buat aku terkejut.' Price text overlays on each product. Bright overhead light."
`,
};
