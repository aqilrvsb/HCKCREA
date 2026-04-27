import type { Skill } from "../../types";

export const hookPainConfession: Skill = {
  id: "pain-confession",
  kind: "hook",
  tab: "ugc",
  title: "Pain Confession Hook (BM)",
  triggers: ["pain", "problem", "confession", "skincare problem", "weight problem", "confidence", "regret"],
  body: `# Pain Confession Hook

**Pattern:** Open with the viewer's exact pain spoken back to them. Names a frustration so specifically that the viewer feels seen.
**Why it works:** Highest CTR for cold-traffic Malaysian skincare/supplement/wellness. Bypasses skepticism by leading with vulnerability, not promise.

## Hook phrase library (verified active 2025-26)
1. "Capek tau, dah habis beribu-ribu dekat klinik tapi jerawat batu tak nak hilang juga?"
2. "Penat tak, tiap pagi cermin still tunjuk kulit yang sama je?"
3. "Kalau kulit korang selalu kusam lepas pukul 12 tengahari padahal dah skincare pagi, ni sebabnya."
4. "Sapa dekat sini yang dah give up nak kulit cerah?"
5. "Dulu aku rasa nak menyerah dah, tapi..."
6. "Korang frust tak, dah pakai macam-macam tapi tak nampak result?"
7. "Aku malu nak cakap tapi... dulu aku avoid cermin."
8. "Macam mana nak cantik kalau kulit dah tenat macam ni?"

## Beat math (first 2s only)
- Word count: 6-12 Malay/EN words MAX (lip-sync constraint)
- Delivery: slow first 1s (set context), tight final 1s (deliver pain)
- Visual: face appears at 0.5s, eye contact established by 1s, problem stated by 2s

## Structural rules
- ALWAYS specific to ONE pain point, never "many problems"
- ALWAYS in the viewer's voice ("kalau korang...", "sapa...")
- NEVER lead with product or brand
- NEVER promise solution in the hook itself — that's for second 4-5

## Pairs best with
- Frameworks: Confession (storytime), PAS (Problem-Agitate-Solve), BAB (Before-After-Bridge), PRP (Problem-Receipt-Proof)
- Personas: Skeptic-Converted, Confessional Intimate, Urban Hijabi Bestie
- Scenes: Confession Storytime, Before-After Skin, Bedroom soft-light

## Pitfalls
- AVOID generic claims like "korang tak puas hati ngan kulit korang ke?" — too vague
- AVOID over-claiming severity ("kulit aku rosak teruk") — triggers TikTok policy flags
- AVOID using clinical terms in the hook ("dermatitis seboreik") — kills relatability

## Veo prompt insertion
Place hook in the dialog field for first 2 seconds. Example:
"She says: 'Capek tau, dah habis beribu-ribu dekat klinik tapi jerawat batu tak nak hilang juga?'"
`,
};
