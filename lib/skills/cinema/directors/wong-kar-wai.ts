import type { Skill } from "../../types";

export const directorWongKarWai: Skill = {
  id: "director-wong-kar-wai",
  kind: "director",
  tab: "cinema",
  title: "Director: Wong Kar-wai",
  triggers: [
    "wong kar wai",
    "wkw",
    "hong kong melancholy",
    "neon bokeh",
    "slow motion romance",
    "in the mood for love",
    "chungking express",
    "urban longing",
    "blurred neon",
  ],
  body: `# Director: Wong Kar-wai

## Identity
Wong Kar-wai (王家衛), Hong Kong New Wave, 1988–present. Architect of cinematic yearning — his films are structured around time lost, love narrowly missed, and memory as texture. Primary works: *Chungking Express* (1994), *In the Mood for Love* (2000), *2046* (2004).

## Visual Signature
- **Color:** Warm ambers, deep reds, acid-yellow street light, cyan-tinted shadows. Neon bleeds into everything.
- **Lighting:** Practical neon sources only. Underexposed interiors. Available light never supplemented cleanly — always diffused, bounced, or gelled with humidity.
- **Movement:** Slow-motion step-printing (skipped frames). Subjects float rather than walk. Background rushes at normal speed while subject lingers in temporal suspension.
- **Depth:** Extremely shallow focus. Eyes sharp, nose soft. Foreground elements (rain, curtain, smoke) blurred into abstract color fields.
- **Composition:** Partial faces, reflections in wet glass, bodies fragmented by architecture.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "warm blurred neon bokeh"
2. "melancholic urban romance"
3. "slow motion impressionism"
4. "shallow-focus yearning faces"
5. "Hong Kong rain-slicked alley"
6. "temporal suspension, step-printed motion"
7. "humid neon haze, amber and red practical lights"
8. "Wong Kar-wai aesthetic, In the Mood for Love cinematography"

## Camera Language Grok Responds To
- "slow-motion push-in on face, neon bokeh background"
- "handheld drift, shallow focus, rain-slicked foreground blur"
- "step-printed movement, subject drifting, street lights smearing"
- "rack focus from neon sign to face in profile"
- "low angle, subject walking, wet pavement reflection below"

## Sample Grok Imagine Prompt
"A woman in a form-fitting cheongsam stands alone in a narrow Hong Kong alleyway at midnight, slow motion impressionism, warm blurred neon bokeh behind her — amber, red, and acid-yellow lights dissolving into soft halos. Shallow-focus yearning face, rain misting the air. She turns her head slightly. Hong Kong rain-slicked alley, humid neon haze. Camera: slow dolly-in on her profile. Cinematic 2.35:1 widescreen. Melancholic urban romance. Audio: distant traffic, rain tap, muffled Cantonese pop from an upper window."

## Best Moods / Scenes
- Romantic longing, missed connections, solitary urban figures
- Product in hand held by an isolated beautiful subject
- Fashion lookbooks — slow elegance
- Perfume / fragrance campaigns with emotional weight
- Nighttime city scenes where atmosphere IS the product

## When NOT to Use (Anti-patterns)
- High-energy action or sports content — the temporal suspension kills kinetics
- Daytime outdoor content — WKW is a nocturnal aesthetic
- Comedy or playful tone — the melancholy framing is incompatible
- Product demos requiring clarity — bokeh dissolves product detail
- Multiple subjects interacting dynamically — WKW frames isolation, not ensemble
`,
};
