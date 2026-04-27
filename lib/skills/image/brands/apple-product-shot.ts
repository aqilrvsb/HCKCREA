import type { Skill } from "../../types";

export const brandAppleProductShot: Skill = {
  id: "apple-product-shot",
  kind: "brand-style",
  tab: "image",
  title: "Apple Product Shot — Pure White Edge-Lit Minimal",
  triggers: [
    "apple product shot",
    "apple style photography",
    "pure white background product",
    "edge lit product",
    "tech product photography",
    "minimal product shot",
    "hardware photography",
    "clean product background",
    "product 70% frame",
    "commercial product white",
  ],
  body: `# Apple Product Shot — Pure White Edge-Lit Minimal

## Brand Identity
Apple's product photography is the global benchmark for "confident product minimalism." Pure white infinity backgrounds, edge lighting that separates the product from white with a hairline of definition, product occupying 70-80% of the frame, and zero visual noise. The product is the only thing that exists. No hands, no context, no story — just object and light.

## Visual Signature
- **Background:** Pure white (#FFFFFF) infinity — no texture, no gradient, no seam visible
- **Lighting:** Three-point edge lighting: subtle rim highlights separating product edges from white background; top-front diffused softbox for surface detail; no harsh specular
- **Framing:** Product fills 70-80% of frame. Centered. 45° or straight-on angle. No crop.
- **Colour:** Colour-accurate, neutral. No warmth or coolness added. Materials render true.
- **Post:** Clean edges, material textures sharp, no shadows on background, optional faint drop shadow beneath product

## Phrase Library
1. "Apple-style product photography, pure white infinity background, edge-lit separation, product 75% frame"
2. "tech hardware product shot, white seamless background, three-point edge lighting, no distractions"
3. "minimal commercial product photo, centered 45-degree angle, rim-lit edges, true colour accuracy"
4. "product hero shot, white background, hairline edge glow, material texture sharp, zero visual noise"
5. "clean product photography, infinity white, softbox front light, subtle drop shadow beneath product"
6. "e-commerce product photo, white background, edge lighting, no props, product dominant"

## Subject Types
- **Product:** All hardware, devices, packaging, accessories, cosmetics, supplement bottles
- **Fashion/Accessories:** Bags, shoes, jewellery when isolated object photography needed
- **Not ideal for:** Lifestyle in-context, editorial with narrative, portraits

## Best Model
**GPT Image 2** — Apple's style requires precise instruction-following for exact background purity, controlled edge lighting, and accurate colour rendering. GPT-2's instruction fidelity (1512 ELO) outperforms Banana here. Use \`input_fidelity="high"\` when editing a reference product image. Banana atmosphericises product images; GPT-2 keeps them clinical.

## Pairs With
- Photographers: None — Apple style is anti-photographer-personality
- Film stocks: None — colour-accurate, no grade
- Composite: \`compositeAmazonListing\` for multi-image e-commerce chains

## Sample Full Prompt (GPT-2)
"Scene: Pure white infinity background, no texture, no visible seam, studio controlled environment. Subject: [Product name] centred in frame, occupying 75% of frame width, photographed at 45-degree angle. Important details: Three-point edge lighting — rim lights defining all product edges against white background with hairline separation, front diffused softbox for surface material clarity, colour-accurate neutral white balance, no warmth shift, material textures sharp and true. Faint natural drop shadow beneath product. Use case: E-commerce hero product listing photo. Constraints: No hands, no props, no context elements, no background gradient, no visible shadow on background walls, no colour cast, no retouching beyond edge cleaning."

## Common Pitfalls
- **Background drifts grey or textured:** Add "pure white #FFFFFF background, no texture, no gradient whatsoever."
- **Edge lighting becomes harsh specular:** Add "soft rim separation, no specular hotspot, diffused edge definition."
- **Product too small in frame:** Add "product dominant, filling 75% of frame, close crop."
- **Banana used instead:** Banana adds atmospheric warmth and texture to white backgrounds — do not use for Apple-style. Route to GPT-2.
`,
};
