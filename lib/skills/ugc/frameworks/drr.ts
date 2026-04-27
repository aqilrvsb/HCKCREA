import type { Skill } from "../../types";

export const frameworkDrr: Skill = {
  id: "drr",
  kind: "framework",
  tab: "ugc",
  title: "DRR — Demo → Reveal → Receipt ('Wait for it')",
  triggers: ["drr", "demo reveal receipt", "demonstration", "wait for it", "product demo", "texture", "application", "show dont tell"],
  body: `# DRR Framework — Demo → Reveal → Receipt

## Structure
1. **Demo (0–8s):** Show the product in use — application, texture, sensory experience. No narration needed in first 2s; let the visual do the work. Hook is embedded in the visual disruption of the demo itself.
2. **Reveal (8–20s):** The unexpected result of the demo — what happened AFTER. Could be skin change, texture transformation, unexpected product behavior. The "wait for it" moment lives here.
3. **Receipt (20–28s):** The validating evidence — before/after, reviews, repeat-purchase behavior, community response. Grounds the reveal in reality.
4. **CTA (28–30s):** Concise. Product name + one action.

### Beat math by length
- **8s:** Demo(4s) → Reveal(3s) → CTA(1s). Receipt implied.
- **15s:** Demo(5s) → Reveal(6s) → Receipt+CTA(4s). Visual-first storytelling.
- **30s:** Demo(8s extended with multiple angles) → Reveal at 15s mark (this is the mid-video hook — peak curiosity) → Receipt(8s) → CTA(4s). Peak-End Rule: Reveal at 15s = emotional peak of the video.

## When to use
- Products with visual wow-factor: texture, color change, instant result, ASMR quality
- Show-don't-tell categories: makeup, skincare serums, hair treatment, supplement dissolving
- TikTok native content where visual hook beats spoken hook
- When you have a genuinely surprising product behavior to showcase

## When NOT to use
- Products with no visual demo moment (abstract supplements with no visible effect)
- Long-tail educational content where mechanism understanding is needed first
- When the product demo requires more than 8s to understand

## Example script (15s, BM-EN)
> **[0–5s — Demo]** *[Close-up: dropper of serum on palm, texture shown, applied to face in circular motion. Sound design: satisfying drops. No talking.]*
> **[5–8s — Setup Reveal]** "Okay so aku selalu apply pagi. But hari ni aku nak tunjuk apa yang jadi kalau korang apply kat area yang biasanya oily by noon..."
> **[8–13s — Reveal]** *[Timelapse or 4-hour later clip: skin matte, pores tighter]* "Ini 4 jam later. Tengok — no touch up. No powder."
> **[13–15s — Receipt + CTA]** "Korang boleh tengok reviews dia kat TikTok Shop. Aku dah repeat order 2 kali."

## Pairs with
- Hooks: Number, Reveal/Suspense, FOMO/Social Proof
- CTAs: TikTok Shop CTA, Comment "DEMO" to learn more
- Personas: Educational Expert, Casual Bestie, Influencer-adjacent
- Scenes: Skincare application macro, Texture close-up, Time-lapse routine

## Conversion psychology
**Zeigarnik Effect + Social Proof:** The "wait for it" in Demo creates an open loop that forces completion. Reveal closes the loop with the reward. Receipt (social proof) neutralizes remaining skepticism. Sequential satisfaction drives purchase intent.

## Pitfalls
- AVOID long demos without payoff — demo without reveal = tutorial, not ad
- AVOID the reveal being too subtle to read on mobile — it must be obvious at 1080p on a 6-inch screen
- AVOID talking over the demo audio — texture/ASMR sound is part of the hook
- AVOID placing the reveal after 20s — viewers drop at 50% completion on 30s; reveal must be at 15s
`,
};
