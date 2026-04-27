import type { Skill } from "../../types";

export const frameworkRdr: Skill = {
  id: "rdr",
  kind: "framework",
  tab: "ugc",
  title: "RDR — Reaction → Discovery → Recommend (First-Time Response)",
  triggers: ["rdr", "reaction discovery recommend", "first time", "unboxing", "genuine reaction", "first impression", "testing", "cuba"],
  body: `# RDR Framework — Reaction → Discovery → Recommend

## Structure
1. **Reaction (0–5s):** Authentic, unscripted-feeling first response to encountering the product. Surprise, delight, skepticism — any genuine emotion. The hook is the reaction, not a spoken line.
2. **Discovery (5–18s):** Walk through what is being discovered in real time — texture, ingredient, packaging detail, unexpected feature. Speaker is figuring it out WITH the viewer, not presenting to them.
3. **Recommend (18–28s):** Conclusion reached through the discovery process. Must feel earned, not predetermined. "Okay so aku rasa..." beats "You should buy this."
4. **CTA (28–30s):** Casual, conversational. "Korang boleh try — link bio."

### Beat math by length
- **8s:** Reaction(2s) → Key discovery(4s) → Casual recommend+CTA(2s).
- **15s:** Reaction(3s) → Discovery(8s) → Recommend+CTA(4s). Best for unboxing/texture reveal.
- **30s:** Reaction(4s) → Discovery walk-through(14s — multiple discovery moments) → Recommend(8s) → CTA(4s). Mid-video hook at 15s: most surprising discovery moment.

## When to use
- Unboxing / first impression content for new product launches
- Products with multiple discovery moments (packaging, texture, scent, result)
- When genuine curiosity is more powerful than polished endorsement
- Community-driven product moments ("my friends sent me this to try")

## When NOT to use
- Products where the speaker is an obvious paid partner (authenticity is destroyed)
- Categories requiring expertise to evaluate (medical devices, clinical supplements)
- Retargeting where audience already knows the product well

## Example script (15s, BM-EN)
> **[0–3s — Reaction]** *[Package arrives. She opens. Eyes widen slightly.]* "Oh wait — packaging dia cantik gila. Okay aku tak expect ni."
> **[3–11s — Discovery]** "Okay texture dia... macam gel tapi lightweight. *[Applies to hand]* Oh dia nampak macam ada glow without glitter. And ingredient list dia ada centella, no fragrance... okay ni pun unexpected."
> **[11–14s — Recommend]** "Kalau korang kulit sensitive macam aku, aku rasa ni worth try. Aku rasa dia tak buat aku breakout based on ingredients. Nak tengok update aku?"
> **[14–15s — CTA]** "Link bio."

## Pairs with
- Hooks: FOMO/Social Proof, Reveal/Suspense, POV ("POV: korang dapat free gift dengan order")
- CTAs: Comment CTA ("comment 'UPDATE' aku bagi 2-week review"), Follow CTA
- Personas: Casual Bestie, Urban Hijabi Bestie
- Scenes: Unboxing shot, Tabletop product discovery, Natural daylight flat-lay reveal

## Conversion psychology
**Social Proof by Proxy:** Viewer experiences the discovery vicariously. Because the speaker's response appears genuine (not pre-scripted), it carries weight equivalent to a trusted friend's recommendation. Parasocial trust converts at peer-recommendation rates.

## Pitfalls
- AVOID over-scripted reactions — even one coached phrase destroys the authenticity of the whole
- AVOID "perfect" camera angles throughout — handheld, slightly rough framing reads as genuine
- AVOID recommending before the discovery is complete — premature endorse = ad signal
- AVOID products with no genuine discovery moment — if everything is as expected, no hook exists
`,
};
