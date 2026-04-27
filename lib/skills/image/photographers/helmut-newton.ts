import type { Skill } from "../../types";

export const photographerHelmutNewton: Skill = {
  id: "helmut-newton",
  kind: "photographer",
  tab: "image",
  title: "Helmut Newton — High-Contrast Sculptural Architecture",
  triggers: [
    "helmut newton",
    "newton style",
    "high contrast fashion",
    "sculptural fashion",
    "architectural framing",
    "black and white fashion editorial",
    "bold shadow fashion",
    "power pose editorial",
    "noir fashion",
    "dominatrix editorial",
  ],
  body: `# Helmut Newton — High-Contrast Sculptural Architecture

## Photographer Identity
Helmut Newton treats the body as architecture and the frame as a blueprint. His images are precise, cold, and commanding — fashion rendered as power rather than beauty. The geometry of a room, a pool edge, or a staircase becomes as important as the subject. Lighting is harsh, contrast is absolute, and ambiguity is eliminated. Every Newton image has a point of view that borders on confrontational.

## Visual Signature
- **Lighting:** Hard directional light — bare flash, harsh sun, or practical overhead. No soft fill. Deep blacks.
- **Composition:** Architectural geometry echoed in the body. Strong diagonals, rigid verticals. Subject often dwarfed by or in contrast with monumental structure.
- **Colour:** High-contrast B&W as default; colour versions are bleached, high-key with saturated accent.
- **Subjects:** Fashion, high-end brand campaigns, dominant female figures in luxury environments.

## Prompt Phrase Library
1. "Helmut Newton-style high-contrast fashion editorial, hard directional flash, deep black shadows, architectural framing"
2. "sculptural body editorial, body geometry echoing room architecture, bare flash lighting, B&W high contrast"
3. "power fashion portrait, harsh overhead light, strong shadow line, luxury hotel geometry, commanding stance"
4. "Newton noir fashion, hotel poolside, bleached whites, deep shadow, body as still-life sculpture"
5. "cold editorial fashion, industrial or marble architecture, rigid composition, confrontational gaze"
6. "monochrome fashion editorial, single hard light source, no fill, sharp geometry, cinematic tension"
7. "luxury fashion power shot, woman in tailored suit, marble column framing, hard side light"

## Best Model
**GPT Image 2** with counter-prompt — Newton's hard-edge geometry and instruction-precise composition are better served by GPT-2's instruction fidelity. However, GPT-2's tendency toward "overcleaned" realism fights Newton's raw contrast. **Always counter-prompt:** add "gritty raw, not over-cleaned, hard edge, film grain, imperfect skin texture" to prevent the model from polishing away Newton's characteristic rawness.

**Banana** is viable for atmospheric B&W editorial but loses the architectural precision and instruction-exact framing that defines Newton's work.

## Subject Types
- **Fashion editorial:** Primary domain — high-end ready-to-wear, couture, accessories
- **Portrait:** Commanding figures, executives, cultural power figures
- **Product:** Only when product is placed in Newton's architectural language (perfume, accessories)
- **Not ideal for:** Soft lifestyle, warm UGC, inclusive body-positive content

## Sample Full Prompt (GPT-2)
"Scene: Grand hotel lobby, white marble floor, ornate columns, late afternoon sun slicing through tall windows. Subject: A woman in a severe black blazer and tailored trousers, standing with legs apart, arms at sides, chin raised, direct gaze. Important details: Single hard sidelight casting strong shadow across half her face and along the marble floor, deep blacks in shadow areas, no fill light, crisp fabric texture, film grain visible, gritty raw finish not over-cleaned. Use case: High-fashion editorial magazine spread. Constraints: No soft glow, no diffusion, no beauty retouching, no romantic lighting; architectural lines must be rigid and precise."

## Counter-Prompt Warnings
- **GPT-2 over-polishes skin:** ALWAYS add "gritty raw, not over-cleaned, visible pore texture, film grain" — this is non-negotiable for Newton style.
- **Composition goes soft/centred:** Add "asymmetric framing, subject placed at edge of frame, strong diagonal shadow line."
- **Lighting too even:** Add "single bare flash or harsh sun, no fill light, shadow-to-highlight ratio 4:1 minimum."
- **If Banana used:** Add "high contrast B&W, no grey midtones softening, architectural geometry sharp."
`,
};
