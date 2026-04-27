import type { Skill } from "../../types";

export const sceneHyperMotionProduct: Skill = {
  id: "hyper-motion-product",
  kind: "scene",
  tab: "ugc",
  title: "Hyper Motion Product — Speed-Ramped Macro Showcase",
  triggers: ["product showcase", "pour", "spray", "asmr product", "macro", "slow motion", "faceless", "powder mixing", "oil pour", "packaging reveal", "swipe swatch"],
  body: `# Hyper Motion Product Scene

**Best for:** skincare drop reveals, supplement powder mixing, sambal/sauce pours, cosmetic swatches, perfume mist, oil pours, packaging tears and peel reveals.
**Best persona:** Product Whisperer (ASMR adjacent, faceless), Educational Expert (paired with VO narration).
**Best voice:** NONE typical (faceless ASMR — let SFX carry), or achernar (whispered narration only).

## Setting block (paste into prompt body)
"Dark or deep-neutral background — matte black, deep slate, or rich wood surface. Single hard rim light from camera-right, catching product edges and liquid motion. OR warm soft key over light wood for food/sauce hero. No clutter. The product IS the subject."

## Camera + framing
- Extreme macro close-up, locked or near-locked (micro-jitter acceptable for organic feel).
- Slight gentle dolly-in during hero moment (pour / drop / spray).
- Occasional overhead top-down for powder or liquid into vessel.
- 9:16 vertical. 85–100mm macro lens feel. NO wide shots.

## Lighting
"Hard single rim light from camera-right, dark background for product hero pop. OR soft warm key from above for food products. Practical only — no diffused softbox wash. Edge glow on liquid, specular on packaging surface."

## Action beats (8s)
- 0–2s : Product appears on surface — static beauty moment, label facing camera, rich texture establishing shot.
- 2–5s : HERO SLOW-MO action moment — powder cascading violently into glass, spray hissing rapidly outward, liquid pouring with large amplitude, oil dropping in heavy slow arc, tape ripping sharply, serum drop falling.
- 5–7s : Settle and texture reveal — liquid surface calms, powder cloud clears, cream swipe texture shows finish.
- 7–8s : Product label re-centres into frame, sharp focus, still — clean brand moment.

## Dialog patterns (Malay/EN code-switch — whispered ASMR only if used)
**Opener (whispered VO):**
- "Dengar bunyi ni... (pause) tu dia."
- "Tengok texture dia jatuh perlahan-lahan."
- "Ni yang buat aku addicted dengan product ni."

**Core (whispered VO):**
- "Satu titik je dah cukup — consistency dia pekat gila."
- "Powder dia halus, tak ada biji-biji — confirm premium quality."
- "Tengok macam mana dia blend — silky, no residue."

**Outro (whispered VO):**
- "Link kat beg kuning. Tengok sendiri lah."
- "Kalau korang nak rasa sendiri, ada free trial tau."
- "Itu je. Tak payah cakap banyak — nampak sendiri."

## Audio (5-layer)
- Dialogue: OPTIONAL — whispered ASMR VO only, or entirely absent. SFX is the primary audio layer.
- SFX: "violent powder cascade into glass, sharp tape-rip crackle, thick syrup drip plonk, spray hiss expanding outward, serum drop surface tension break, packaging crinkle and crush, oil pour glug".
- Ambience: near-silence — "faint room tone only, no ambient crowd or environment".
- Music: NONE preferred. If used: sub-bass drone, single sustained note — never melodic.
- Negatives: "no upbeat music, no voice narration unless whispered, no humans in frame".

## Veo prompt skeleton
"Extreme macro close-up, 85mm, hard rim light from camera-right, deep dark background. <PRODUCT> rests on matte black surface. Slow-motion: <PRODUCT ACTION — e.g. 'powder cascading violently into glass', 'spray hissing rapidly outward'>. Camera holds, product settles. Product label re-centres into frame, sharp focus. No humans visible. SFX: <PRIMARY SFX>. Near-silent ambience. Voice direction: <VOICE_ID> whispered if used. 9:16."

## Common failure modes (and fixes)
- Human appearing in shot → EXPLICITLY add "no humans visible in any frame. Hands only if absolutely required for product manipulation, and only from wrist down — never face, never body".
- Action looks normal speed → add adverb-intensity qualifiers: "cascading violently", "hissing rapidly", "pouring with large amplitude", "dropping in heavy slow arc" — Veo responds to adverb intensity for speed-ramp.
- Background too bright → add "matte black or deep slate background, NO white or light backgrounds — product must pop against dark".
- Label unreadable → add "product label clearly legible in final 1 second, camera holds still on label".
- ASMR audio missing → explicitly list each SFX event with descriptive language — Veo requires named SFX in prompt, not implied.
`,
};
