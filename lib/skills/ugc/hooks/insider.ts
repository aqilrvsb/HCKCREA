import type { Skill } from "../../types";

export const hookInsider: Skill = {
  id: "insider",
  kind: "hook",
  tab: "ugc",
  title: "Insider / Forbidden Knowledge Hook",
  triggers: ["insider", "forbidden", "delete", "secret", "boss", "supplier", "they don't want you to know", "rahsia", "jangan share"],
  body: `# Insider / Forbidden Knowledge Hook

**Pattern:** "Boss aku suruh delete video ni tapi..." — speaker positions as an insider leaking information that powerful parties want suppressed. Creates instant conspiracy-curiosity loop.
**Why it works:** Forbidden information is cognitively irresistible. The implication that someone is trying to STOP the viewer from seeing this triggers reactance — the desire to see it MORE. Highest share-rate hook category.

## Hook phrase library (verified active 2025-26)
1. "Boss supplier aku suruh delete tapi korang kena tau ni."
2. "Dermatologist tak suruh aku share ni tapi aku share jugak."
3. "Orang dalam industry ni takkan cakap kat korang — tapi aku akan."
4. "Ni yang brand besar taknak korang tau pasal ingredient dorang."
5. "Aku kena signing NDA tapi dah habis, so aku boleh cakap sekarang."
6. "Sales rep cakap jangan compare dengan brand lain tapi korang decide sendiri."
7. "Ramai influencer dah kena DM suruh stop cakap pasal ni. Tapi aku cakap lagi."
8. "Perkara yang korang tak akan nampak kat iklan TV — ni realiti dia."
9. "Sebab aku berhenti jadi loyal customer brand tu — ni yang jadi bila aku mula tanya soalan."

## Beat math (first 2s only)
- Word count: 8-12 words — setup the "who wants to stop this" in first 1s, "but" pivot at 1.5s
- Delivery: slightly hushed/conspiratorial tone; lean into camera slightly
- Visual: close-up face, low-key lighting reinforces "insider" feel; no branded backgrounds

## Structural rules
- ALWAYS make the forbidden information genuinely useful — payoff must match the intrigue setup
- ALWAYS use plausible insiders ("boss supplier", "dermatologist") not implausible ones ("kerajaan")
- NEVER fabricate industry claims that can be verified and disproven
- NEVER imply illegal activity or regulatory suppression of a legal product

## Pairs best with
- Frameworks: MBT (Myth-Bust-Truth), ARP (Authority-Recommend-Proof), PRP (Problem-Receipt-Proof)
- Personas: Educational Expert, Skeptic-Converted
- Scenes: Office Vitamin scene, Talking head with product, Ingredient research scene

## Pitfalls
- AVOID conspiracy framing that implies government/medical suppression of a real medical treatment
- AVOID "they don't want you healthy" type language — TikTok misinformation policy risk
- AVOID fabricating insider credentials ("aku kerja klinik") without real basis
- AVOID overusing — once per campaign; becomes parody if used repeatedly by same face

## Veo prompt insertion
Low-key, slightly hushed delivery setup. Example:
"She leans slightly toward camera, lowered voice, says: 'Boss supplier aku suruh delete tapi korang kena tau ni.' Minimal background, warm but dim light. Cut to product reveal at 3s."
`,
};
