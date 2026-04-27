import type { Skill } from "../../types";

export const hookEnemy: Skill = {
  id: "enemy",
  kind: "hook",
  tab: "ugc",
  title: "Enemy Hook (Category Challenger)",
  triggers: ["enemy", "stop using", "korang akan stop", "challenge category", "ditch", "switch", "never again", "replace", "abandon"],
  body: `# Enemy Hook

**Pattern:** "Korang akan stop pakai foam cleanser lepas tengok ni..." — declares war on an entire category, product type, or habit the viewer currently uses. Forces the viewer to defend (watch) or discover they've been wrong.
**Why it works:** The viewer has a vested interest — they USE foam cleansers. The hook puts their current behavior on trial. They MUST watch to find out if they're the villain of their own skincare story. Category-challenger positioning also signals confidence in the alternative.

## Hook phrase library (verified active 2025-26)
1. "Korang akan stop pakai foam cleanser lepas tengok ni — serious."
2. "Ni sebab aku dah delete semua toner dari routine aku."
3. "Stop buy gym supplement sebelum tengok apa aku ganti dengan ni."
4. "Kalau korang masih pakai bar soap kat muka — maaf, aku kena cakap ni."
5. "Ni kenapa aku dah quit exfoliating twice a week padahal semua orang suruh buat."
6. "Selepas video ni korang akan check ingredient list setiap cleanser korang ada."
7. "Aku dah buang RM200 worth of skincare lepas tau pasal benda ni."
8. "Korang akan rethink setiap 'hydrating' claim pada produk korang lepas ni."
9. "Ni sebab aku stop recommend drugstore SPF kat semua orang dalam circle aku."

## Beat math (first 2s only)
- Word count: 7-11 words — enemy category named by 1s, consequence/teaser by 2s
- Delivery: confident, slightly conspiratorial — "I know something you don't yet"
- Visual: speaker holds or gestures at the enemy product category then sets it aside

## Structural rules
- ALWAYS name a CATEGORY not a specific brand (cleanser, not "Brand X cleanser")
- ALWAYS give a credible reason within 8s — "lepas tengok ni" must be paid off fast
- NEVER make the enemy so universal that the switch seems impossible ("stop washing face")
- Hero product MUST be visually present by 5s minimum — brand visible before half-mark

## Pairs best with
- Frameworks: MBT (Myth-Bust-Truth), PAS, Direct Response, COI
- Personas: Educational Expert, Skeptic-Converted, Roast persona
- Scenes: Product swap shot, Ingredient comparison, Bathroom product clear-out

## Pitfalls
- AVOID targeting categories with no credible alternative (creates FUD without solution)
- AVOID claiming a category is "dangerous" without scientific basis — TikTok health claim policy
- AVOID named brand enemies in any paid ad context
- AVOID the "enemy" being something only a minority uses — it must be a habit most viewers have

## Veo prompt insertion
Speaker holds enemy product, then sets it aside to reveal hero product. Example:
"She holds foam cleanser, says: 'Korang akan stop pakai foam cleanser lepas tengok ni.' Sets it aside. Hero product revealed at 3s. Natural bathroom lighting."
`,
};
