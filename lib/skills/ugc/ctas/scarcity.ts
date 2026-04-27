import type { Skill } from "../../types";

export const ctaScarcity: Skill = {
  id: "scarcity",
  kind: "cta",
  tab: "ugc",
  title: "Scarcity CTA (Stock-Limited)",
  triggers: ["scarcity", "stok", "sold out", "habis", "restock", "last unit", "terhad", "running out"],
  body: `# Scarcity CTA

**Pattern:** Stock is genuinely limited or unpredictably restocked — communicate this as a fact, not a threat. The viewer risks missing out entirely, not just a deal.

**Psychology (Cialdini — Scarcity):** Pure supply scarcity triggers fear of permanent loss. Unlike urgency (time), scarcity is unbounded — "tak tahu bila restock" means the loss could be indefinite. This creates stronger FOMO than time-limited deals. Works best on genuinely popular SKUs.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Stok last! Tak tahu bila restock."
2. "Buat cepat sebelum habis, serius ni."
3. "Aku tak jamin esok ada lagi."
4. "Sering sangat sold out — kalau nampak ada, terus grab."
5. "Aku pun kena waiting list dulu, tu pasal lambat share ni."
6. "Diorang restock slow je — habis means habis."
7. "Kalau korang tengah tengok ni and stok still ada, tu rezeki."
8. "Aku check tadi tinggal sikit je lagi. Beg kuning kalau nak."
9. "Last batch ni — supplier confirm takda ETA untuk next restock."
10. "Jangan screenshot dulu, order dulu. Screenshot takda guna kalau habis."

## Beat math (last 2-3s of video)
- Word count: 8-14 BM words
- Delivery: matter-of-fact, slightly reluctant — as if sharing insider info, NOT a sales pitch
- Visual: small shrug OR hands-up gesture at "tak tahu bila" reinforces authenticity
- Timing: stock-fact (1s) → consequence (0.5s) → action call (0.5s)

## Pairs best with
- Hooks: Pain Confession, Social Proof opening
- Frameworks: Confession Storytime, PRP (Problem-Receipt-Proof)
- Personas: Skeptic-Converted, Hijabi Bestie, Mak Cik Auntie
- Funnel stage: BOFU — hot audience, they're ready, scarcity pushes over the line

## Pitfalls
- NEVER use fake scarcity on a product with unlimited inventory — customers will expose this in comments
- AVOID dramatic delivery ("HABIS DAH TINGGAL SATU!") — sounds scripted, drops trust
- AVOID stacking scarcity + urgency in one phrase — pick one or the other per video

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She shrugs slightly and says: 'Stok last, tak tahu bila restock. Beg kuning kalau nak.' — casual, matter-of-fact delivery, like sharing a tip not selling."
`,
};
