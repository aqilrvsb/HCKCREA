import type { Skill } from "../../types";

export const brandMujiAesthetic: Skill = {
  id: "muji-aesthetic",
  kind: "brand-style",
  tab: "image",
  title: "MUJI Aesthetic — Warm Neutral Minimal Natural Indirect",
  triggers: [
    "muji aesthetic",
    "muji style",
    "warm minimal product",
    "neutral surface product",
    "beige minimal photography",
    "japanese minimal photography",
    "natural indirect light product",
    "wabi sabi product",
    "earthy minimal",
    "linen texture product photography",
  ],
  body: `# MUJI Aesthetic — Warm Neutral Minimal Natural Indirect

## Brand Identity
MUJI's visual language says: "good things don't shout." Warm natural surfaces — linen, unbleached cotton, bare wood, matte ceramic — receive products in indirect natural light. The palette is beige, cream, warm grey, and natural wood tones. Props are minimal and thematic. The mood is restful, considered, slightly Japanese in its restraint.

## Visual Signature
- **Surfaces:** Linen cloth, unbleached cotton, bare wood grain, matte concrete, raw paper — never gloss, never white plastic
- **Lighting:** Indirect natural light, soft window diffusion, no specular highlights, even soft modelling
- **Colour:** Beige, cream, warm grey, natural wood. No saturated accent colours. Warm white balance.
- **Props:** 1-3 maximum, thematically connected, never decorative for decoration's sake
- **Composition:** Breathing room — product does not dominate, negative space is intentional

## Phrase Library
1. "MUJI-style product photography, warm linen surface, indirect natural window light, beige and cream palette"
2. "Japanese minimal product shot, bare wood surface, soft diffused natural light, restrained prop styling"
3. "warm neutral minimal, unbleached cotton backdrop, no specular highlights, breathing room composition"
4. "wabi-sabi product photography, natural texture surfaces, muted warm palette, single indirect light source"
5. "earthy minimal commercial photo, linen and ceramic, warm grey tones, considered negative space"
6. "natural light product, warm wood and cotton, minimal prop count, no shadows, restful mood"

## Subject Types
- **Product:** Skincare, wellness, food, home goods, stationery, minimal fashion accessories
- **Lifestyle:** When lifestyle needs quiet restraint, not aspiration
- **Not ideal for:** Tech hardware, bold fashion, anything requiring colour accuracy or energy

## Best Model
**Banana Pro** — MUJI's indirect natural light, surface texture depth, and atmospheric restraint are precisely Banana's atmospheric photoreal strength. The warm surface materials (linen grain, wood texture) render with Banana's native environmental understanding. GPT-2 over-clarifies and produces surfaces that look rendered rather than material.

## Pairs With
- Photographers: Peter Lindbergh (natural desaturation), Annie Leibovitz (environmental meaning in objects)
- Film stocks: Kodak Portra 160 (muted, warm, natural)
- Composite: \`compositeCharacterProduct\` for lifestyle-in-scene with MUJI-world background

## Sample Full Prompt (Banana)
"A matte ceramic supplement jar placed on a natural linen cloth, soft indirect window light from the left casting barely-visible shadow modelling. Background: warm cream-painted wall, slightly out of focus. One sprig of dried botanicals placed nearby. Palette: cream, warm beige, natural wood tone shelf edge barely visible at bottom. MUJI-style minimal product photography, warm neutral colour grade, no specular highlights on ceramic surface, breathing negative space to right of product, natural linen texture sharp. 50mm equivalent lens, slight depth of field blur on background."

## Common Pitfalls
- **Banana over-warms to golden:** Add "restrained warm white balance, not golden hour, soft neutral warmth only."
- **Props multiply and distract:** Add "maximum 2 props, thematically connected, no decorative excess."
- **Background goes pure white instead of warm cream:** Add "warm cream or linen-toned background, not pure white."
- **Texture renders plastic instead of material:** Add "natural material texture — linen weave, wood grain, ceramic matte visible and sharp."
`,
};
