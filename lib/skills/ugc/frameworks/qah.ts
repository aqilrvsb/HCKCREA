import type { Skill } from "../../types";

export const frameworkQah: Skill = {
  id: "qah",
  kind: "framework",
  tab: "ugc",
  title: "QAH — Question → Answer → Hint (Reciprocity Engine)",
  triggers: ["qah", "question answer hint", "faq", "q and a", "reciprocity", "value first", "educational", "answer question", "soalan"],
  body: `# QAH Framework — Question → Answer → Hint

## Structure
1. **Question (0–3s):** Open with a question the viewer is genuinely asking. Can be posed as "a lot of you ask me" or by the speaker themselves. Must be a real question with a non-obvious answer.
2. **Answer (3–18s):** Deliver a genuinely useful, specific answer — not a product pitch. The answer has value independent of the product. This is the reciprocity investment.
3. **Hint (18–28s):** The product is introduced as the practical application of the answer — not the answer itself. "Kalau nak implement ni dengan senang, ni yang aku guna." It's a hint, not a hard sell.
4. **CTA (28–30s):** Soft: "Korang ada soalan lain? Drop kat comments." OR "Try dia — link bio."

### Beat math by length
- **8s:** Question(1s) → Answer headline(5s) → Hint+CTA(2s). Value delivered in 5s — compressed but punchy.
- **15s:** Question(2s) → Answer(9s) → Hint+CTA(4s). Education-first format. Best for DM-driven funnels.
- **30s:** Question(3s) → Full educational answer(14s) → Hint with mechanism(8s) → CTA(5s). Mid-video hook at 15s: most counterintuitive part of the answer.

## When to use
- Content that organically answers search-intent questions (what is, why does, how to)
- Supplement and functional ingredient categories (audiences want to understand before buying)
- Brand building alongside direct response — QAH drives follows alongside conversions
- When comment engagement and saves are campaign KPIs alongside purchase

## When NOT to use
- Pure performance campaigns where education delays conversion (use PAS or DRR instead)
- Products where the answer is identical to the pitch (too obvious = low trust)
- 8s format for complex topics — answer needs space to be genuinely useful

## Example script (15s, BM-EN)
> **[0–2s — Question]** "Ramai tanya aku: kenapa vitamin C serum tak berkesan walaupun dah pakai berbulan?"
> **[2–11s — Answer]** "Sebab vitamin C unstable dan oxidize bila kena udara dan cahaya. Bila dia dah turn orange dalam botol tu — dia dah tak aktif. Percentage pun matter: bawah 10% tak cukup potent. And pH — kena bawah 3.5 untuk absorb betul."
> **[11–14s — Hint]** "Ni yang aku guna — airless pump bottle, 15% L-ascorbic acid, pH 3.2. Dia tak oxidize cepat and aku actually nampak result dalam 3 minggu."
> **[14–15s — CTA]** "Korang boleh check sendiri — link bio."

## Pairs with
- Hooks: Number ("3 sebab vitamin C tak kerja"), Insider, Red Flag
- CTAs: Comment CTA ("soalan lain? komen bawah"), Save CTA ("save ni untuk reference")
- Personas: Educational Expert, Casual Bestie (approachable expert)
- Scenes: Talking-head with text overlay, Ingredient close-up, Whiteboard/visual aid

## Conversion psychology
**Reciprocity (Cialdini):** Giving genuine value BEFORE asking creates a felt obligation. When a viewer receives a useful, specific answer, they experience micro-gratitude. The subsequent Hint is received as "the same person who helped me is now recommending this" — far stronger than a cold product pitch. Saves and shares are highest in QAH format because the answer has standalone utility.

## Pitfalls
- AVOID questions with obvious answers (no tension = no watch-through)
- AVOID making the answer just the product pitch in disguise — viewers detect this instantly
- AVOID multiple questions in one video — QAH works on one specific question per video
- AVOID weak hints ("korang boleh cuba mana-mana vitamin C") — hint must point specifically to hero product with specific reason
`,
};
