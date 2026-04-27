import type { Skill } from "../../types";

export const ctaUrgency: Skill = {
  id: "urgency",
  kind: "cta",
  tab: "ugc",
  title: "Urgency CTA (Time-Limited)",
  triggers: ["urgency", "hari ni", "limited time", "flash sale", "harga", "esok naik", "today only", "deadline"],
  body: `# Urgency CTA

**Pattern:** Frame the purchase window as time-limited — today only, price resets tomorrow, promo ends tonight. Forces decision NOW rather than "later" (which is never).

**Psychology (Cialdini — Scarcity + Loss Aversion):** Loss aversion is 2x more powerful than equivalent gain. "Esok harga naik balik" hits harder than "save RM20 today" because the viewer is losing something they already feel entitled to. Time constraint converts fence-sitters.

## CTA phrase library (10 BM/EN verified active 2025-26)
1. "Hari ni je harga ni. Esok dah naik balik — confirm."
2. "Promo habis malam ni 12am. Lepas tu full price."
3. "Flash sale sampai stok habis je — tak ada masa esok."
4. "Harga TikTok Shop exclusive ni tak boleh guarantee sampai esok."
5. "Aku tak tahu bila diorang nak end promo ni, so jangan tunggu."
6. "Today only deal — esok korang bayar double, bukan salah aku."
7. "Voucher habis dalam masa 2 jam — pergi claim dulu baru scroll."
8. "Harga launch ni untuk early adopters je. Dah dekat habis slot."
9. "Grab sebelum 12 malam — free gift attach sekali lepas tu gone."
10. "Korang ada maybe 3 jam lagi untuk harga ni. Beg kuning bawah."

## Beat math (last 2-3s of video)
- Word count: 10-16 BM words
- Delivery: measured urgency — NOT panicked, NOT fake. Calm confidence that the deadline is real
- Visual: slight lean-in toward camera OR glance at phone as if checking countdown
- Timing: state the time boundary first (1s), then the action (1s), cut

## Pairs best with
- Hooks: Pain Confession, POV Flash
- Frameworks: PAS, Confession Storytime, Direct Demo
- Personas: Urban Expert, Skeptic-Converted
- Funnel stage: BOFU — best for warm/hot audience already researching the product

## Pitfalls
- NEVER invent a fake deadline that resets every 24h — Malaysian audiences recognize manufactured urgency, kills trust permanently
- AVOID vague urgency ("cepat sikit") — specificity ("malam ni 12am") converts 3x better
- NEVER pair with cold TOFU audience — urgency without trust = hostility

## Veo prompt insertion
Place in dialog field for final 2-3s:
"She glances at phone briefly then back to camera: 'Hari ni je harga ni. Esok dah naik balik — confirm.' — calm, certain delivery, not panicked."
`,
};
