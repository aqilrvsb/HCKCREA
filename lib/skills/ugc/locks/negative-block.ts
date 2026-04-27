import type { Skill } from "../../types";

export const lockNegativeBlock: Skill = {
  id: "negative-block",
  kind: "lock",
  tab: "ugc",
  title: "Negative Block Lock (Style Exclusion List)",
  triggers: ["negative", "no cartoon", "no anime", "no 3D", "style exclusion", "no glam", "no studio", "negative prompt"],
  body: `# Negative Block Lock

## The exact lock text
\`\`\`
Negative: cartoon, 3D cartoon, anime, plastic skin, glam makeup, softbox studio lighting, motion blur on product label, over-saturated color grading, film grain filter, cinematic color grade, beauty filter, AI art style
\`\`\`

## Why it exists
Without an explicit negative block, Veo's default style bias pulls toward:
- **Cartoon / anime creep**: any scene with exaggerated expression or lighting cue can slide into anime aesthetic
- **3D cartoon**: indoor scenes with soft lighting render as Pixar-style if not blocked
- **Plastic skin + glam makeup**: Veo's default "beautiful person" archetype includes heavy foundation and airbrushed skin — the opposite of authentic UGC skin texture
- **Cinematic color grade**: teal-orange LUT, film grain, crushed blacks — all incorrect for UGC authenticity
- **Motion blur on label**: fast pan shots cause label text to blur, combining with product-ref failure

Each negative term costs ~1-2 tokens and prevents an entire class of regenerations. The negative block is the cheapest investment per failure prevented.

## When to disable / soften
- **Explicitly requested cartoon scene**: remove cartoon/3D cartoon/anime negatives; keep plastic skin + softbox negatives
- **Stylized brand video** (user wants cinematic grade): remove cinematic color grade negative; keep anatomy-relevant items
- **Deepavali / CNY festive content with stylized look**: can allow "vibrant color saturation" while keeping plastic skin block
- **Beauty brand cinematic close-up**: can allow shallow DOF and soft lighting while keeping anime negative

## Veo failure if absent
Scene: hijabi creator in warm-lit bedroom. Without negative block → Veo outputs anime-style illustration of a girl in hijab with large eyes, cel-shaded skin, and glowing skin texture. Zero resemblance to UGC. Full scene invalid. Occurs in ~25% of unguided warm-lighting scenes.

## Notes
"AI art style" as a negative is a meta-block that catches miscellaneous style drift not covered by specific terms. Veo self-cites "digital art" aesthetics when confused about context — this block suppresses it. Always keep this as the final item in the negative list.
`,
};
