import type { Skill } from "../../types";

export const hookRedFlag: Skill = {
  id: "red-flag",
  kind: "hook",
  tab: "ugc",
  title: "Red Flag Hook (Mistake Identification)",
  triggers: ["red flag", "warning sign", "mistake", "miss", "tanda bahaya", "checklist", "korang buat ni ke", "terlepas pandang"],
  body: `# Red Flag Hook

**Pattern:** "Red flag bila beli skincare online — aku miss semua ni..." — opens with a checklist-implied list of mistakes the viewer is probably already making. Combines loss-aversion with self-identification.
**Why it works:** "Red flag" is a culturally loaded phrase in Malaysian Gen Z vocabulary — instantly parsed as a relationship/life-vetting framework applied to products. Self-incriminating admission ("aku miss semua ni") builds speaker credibility through vulnerability.

## Hook phrase library (verified active 2025-26)
1. "Red flag bila beli skincare online — aku miss semua ni dulu."
2. "Kalau sunscreen korang ada benda ni, return cepat."
3. "3 red flag dalam ingredient list collagen yang korang patut check."
4. "Tanda-tanda moisturizer korang tak sesuai dengan skin type — aku baru perasan."
5. "Red flag #1: korang rasa kulit makin oily lepas pakai moisturizer. Ni kenapa."
6. "Checklist sebelum beli supplement online — sorang pun aku tak check dulu."
7. "Korang buat silap yang sama macam aku tak? Tengok ni."
8. "Benda ni kat label produk korang = red flag besar. Jangan abaikan."
9. "5 tanda cleanser korang rosak skin barrier — no.3 ramai buat tapi tak sedar."

## Beat math (first 2s only)
- Word count: 7-11 words — "red flag" spoken first (0–0.5s), context by 1s, self-implication by 2s
- Delivery: slightly urgent but matter-of-fact; speaker is a friend flagging a mistake, not lecturing
- Visual: direct camera, or zoom onto product label — visual red flag (finger pointing to text) works well

## Structural rules
- ALWAYS self-implicate speaker in having missed the red flags — "aku pun buat dulu" adds credibility
- ALWAYS list specific, verifiable red flags (ingredient names, packaging claims, certifications)
- NEVER use vague red flags ("kalau tak ada review, tu red flag") — too obvious to be useful
- NEVER frame red flags in ways that directly defame a named competitor brand

## Pairs best with
- Frameworks: MBT (Myth-Bust-Truth), COI (Cost of Inaction), PAS, Direct Response
- Personas: Educational Expert, Skeptic-Converted, Confessional Intimate
- Scenes: Ingredient label close-up, Product comparison shelf, Bathroom routine

## Pitfalls
- AVOID generic red flags that apply to all products (boring, no hook power)
- AVOID clinical language that sounds like medical advice
- AVOID listing too many red flags in 15s format — 1-2 specific ones beat 5 vague ones
- AVOID implying current product they own is dangerous without offering the solution

## Veo prompt insertion
Finger pointing to product label, close-up detail shot. Example:
"She holds product close to camera, points to ingredient list, says: 'Red flag bila beli skincare online — aku miss semua ni dulu.' Cut to finger underlining specific ingredient word."
`,
};
