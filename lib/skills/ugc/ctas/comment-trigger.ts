import type { Skill } from "../../types";

export const ctaCommentTrigger: Skill = {
  id: "comment-trigger",
  kind: "cta",
  tab: "ugc",
  title: "Comment Trigger CTA (DM Funnel)",
  triggers: ["comment", "dm", "keyword comment", "glow", "link", "comment trigger", "comment cta", "funnel"],
  body: `# Comment Trigger CTA

**Pattern:** Ask viewer to drop a keyword in comments; creator DMs the link. Creates engagement signal, extends reach via algorithm, and warms the lead before purchase.

**Psychology (Cialdini — Commitment & Consistency + Reciprocity):** The act of commenting is a micro-commitment — once someone types "GLOW", they've invested effort and feel obligated to follow through. The DM creates a 1:1 reciprocity loop. TikTok's algorithm also boosts comment-heavy videos, compounding reach.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Comment GLOW dekat bawah, aku DM korang link."
2. "Type 'CERAH' dalam komen, aku send direct."
3. "Comment 'NAK' kat bawah — aku balas sorang-sorang."
4. "Kalau nak info lagi, comment INFO bawah ni."
5. "Drop 'LINK' dalam komen, aku DM korang dalam masa sejam."
6. "Comment nama korang bawah, aku tag korang balik ngan details."
7. "Type 'SERIOUS' kalau korang betul-betul nak try — aku DM."
8. "Comment 'BERKESAN' kalau korang nak aku explain cara pakai."
9. "Letak emoji 🌟 dalam komen, aku faham korang nak tahu lebih."
10. "Comment anything bawah ni — aku reply dengan full info."

## Beat math (last 2-3s of video)
- Word count: 8-14 BM words
- Delivery: warm, personal, like leaving an invitation — NOT a command
- Visual: finger pointing downward toward comment section area
- Timing: keyword instruction (1s) → promise/payoff (1s) — simple two-beat close

## Pairs best with
- Hooks: Pain Confession, POV, Educational opener
- Frameworks: PAS, Educational walkthrough, Storytime
- Personas: Hijabi Bestie, Confessional Intimate, Educational Expert
- Funnel stage: MOFU — best for warm audiences who need one more touch before purchase

## Pitfalls
- NEVER use comment trigger as a BOFU CTA replacement when TikTok Shop is available — beg kuning converts faster
- AVOID vague keywords ("comment anything!") — specific words create stronger commitment
- AVOID promising instant DM if volume is high — set realistic expectations ("aku reply dalam masa sejam")
- TikTok restricts some automated DM flows — use native TikTok DM or set reminder to manually reply

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She points toward the comment section and says: 'Comment GLOW dekat bawah, aku DM korang link.' — warm, friendly tone, slight smile, like inviting a friend."
`,
};
