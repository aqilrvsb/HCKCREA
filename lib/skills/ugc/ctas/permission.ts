import type { Skill } from "../../types";

export const ctaPermission: Skill = {
  id: "permission",
  kind: "cta",
  tab: "ugc",
  title: "Permission CTA (Context-First Soft Close)",
  triggers: ["permission", "soft close", "context", "humidity", "malaysia weather", "routine", "lifestyle", "mofu", "pre-sell"],
  body: `# Permission CTA

**Pattern:** Earn the right to make the recommendation by acknowledging the viewer's exact context first. "Kalau nak [specific desired outcome] in [specific Malaysian context], ni cara aku." Feels like advice, not a pitch.

**Psychology (Cialdini — Liking + Authority):** By naming the viewer's world precisely (humidity, lifestyle, budget), you signal genuine understanding. This builds the authority needed for the recommendation to land. The "cara aku" framing positions it as personal practice, not product pushing.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Kalau nak kulit hold moisture in Malaysian humidity, ni cara aku."
2. "Kalau korang kerja outdoor and nak kulit survive panas KL, this is the way."
3. "Untuk akak yang busy — kalau nak routine yang 3 langkah je, ni."
4. "Kalau nak makeup stay intact dari Subuh sampai Isyak, ni approach aku."
5. "Kalau budget korang realistic and nak result yang betul, ni pilihan aku."
6. "Untuk korang yang pakai tudung — kalau nak kulit tepi muka tak break out, cuba ni."
7. "Kalau korang nak supplement yang halal-certified and proven, ni satu-satunya yang aku trust."
8. "Kalau nak kulit recover after long Ramadan fasting period, cara aku macam ni."
9. "For Malaysian skin yang dah over-exfoliated — kalau nak reset barrier, ni protocol aku."
10. "Kalau nak harga berbaloi without kena tipu, cara aku pilih product macam ni."

## Beat math (last 2-3s of video)
- Word count: 12-18 BM/EN words
- Delivery: conversational, first-person — "I'm sharing what works for me"
- Visual: relaxed, open body language — no hard sell gesture, slight smile
- Timing: context acknowledgment (1s) → personal recommendation (1s) — steady, unhurried

## Pairs best with
- Hooks: Educational opener, How-I-Fixed-It opener
- Frameworks: How-It-Works, PRP, Before-After-Bridge
- Personas: Urban Expert, Educational Expert, Hijabi Bestie
- Funnel stage: MOFU — requires enough context for the recommendation to feel earned

## Pitfalls
- AVOID generic contexts ("untuk sesiapa yang nak cantik") — specificity is what earns the permission
- NEVER pivot immediately to a hard sell after a permission frame — it breaks the trust contract
- AVOID overclaiming authority ("aku expert") — let the context-specificity do the authority work

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She speaks calmly, directly to camera: 'Kalau nak kulit hold moisture in Malaysian humidity, ni cara aku.' — no hard sell energy, relaxed, like ending a conversation with a trusted friend."
`,
};
