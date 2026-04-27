import type { Skill } from "../../types";

export const brandGlossierFlatLay: Skill = {
  id: "glossier-flat-lay",
  kind: "brand-style",
  tab: "image",
  title: "Glossier Flat Lay — Pastel Diffused Lifestyle Props",
  triggers: [
    "glossier flat lay",
    "glossier style",
    "pastel product flat lay",
    "pink white flat lay",
    "soft diffused flat lay",
    "beauty product flat lay",
    "lifestyle props flat lay",
    "instagram flat lay",
    "skincare flat lay",
    "pink aesthetic product",
  ],
  body: `# Glossier Flat Lay — Pastel Diffused Lifestyle Props

## Brand Identity
Glossier turned millennial pink and soft diffused light into a beauty philosophy. Their flat-lay language is instantly recognisable: overhead shot, pastel backgrounds (blush pink, soft lavender, cloud white), perfectly imperfect prop placement, soft lifestyle objects (florals, fabrics, jewelry, fruit slices) mixed with the product. The mood is: "this is how I actually live, but prettier."

## Visual Signature
- **Background:** Blush pink, soft white, pale lavender, or warm pastel — never bold, never dark
- **Lighting:** Soft, even, diffused — top-lit with a large diffusion panel or overcast window. No shadows. No specular. Light bounces everywhere.
- **Composition:** Overhead flat lay (90° above). Props arranged with considered imperfection — not rigid grid, not chaotic.
- **Props:** Florals, ribbon, silk fabric scraps, fresh citrus, jewellery, pearls, cotton rounds — all in the pastel palette
- **Colour:** Monochromatic pastel or soft complementary. Pink, peach, cream, lavender, mint.

## Phrase Library
1. "Glossier-style pastel flat lay, blush pink background, soft diffused top light, lifestyle props arranged"
2. "beauty product flat lay, overhead 90-degree shot, pastel palette, florals and silk fabric props"
3. "skincare Instagram flat lay, pink and white palette, no shadows, even soft light, scattered petals"
4. "soft lifestyle flat lay, cream and blush, product surrounded by thematic props, airy mood"
5. "millennial pink product photography, overhead flat lay, diffused even light, no harsh shadow"
6. "beauty brand flat lay, pastel background, ribbon and pearl props, product center-prominent"

## Subject Types
- **Product:** Skincare, beauty, supplements, wellness, anything with a feminine/clean lifestyle aesthetic
- **Lifestyle:** When product needs a "this is part of my beautiful routine" feeling
- **Not ideal for:** Tech hardware, masculine brand direction, dark or bold aesthetic brands

## Best Model
**GPT Image 2** — Flat lay composition requires precise overhead spatial reasoning and prop placement instruction-following. GPT-2's instruction fidelity handles "place product top-left third, roses scattered bottom-right, silk fabric folded bottom-left" precisely. Banana loses spatial precision in flat-lay overhead compositions, drifting props and misreading top-down geometry.

## Pairs With
- Photographers: Mario Testino (warmth + energy, though Testino is 3D not flat), Annie Leibovitz (for when flat lay is elevated to art object)
- Film stocks: Fujifilm Pro 400H (pastel film rendering, natural diffusion)
- Composite: \`compositeAmazonListing\` for multi-angle beauty listing chains

## Sample Full Prompt (GPT-2)
"Scene: Overhead 90-degree flat lay on blush pink matte paper background, no texture visible. Subject: [Product name] placed at left-center of frame, label facing camera directly. Important details: Surrounding props — fresh pink rose petals scattered organically around product, small pearl strand looping from top-right, folded cream silk fabric at bottom-right corner, two dried lavender stems at top-left. Soft even top-light, no visible shadows, no specular highlights, pastel palette throughout. Use case: Instagram beauty product lifestyle flat lay. Constraints: No dark shadow, no coloured background outside pastel range, product label fully readable, no prop overlapping product label."

## Common Pitfalls
- **GPT-2 creates harsh single-source shadow:** Add "even diffused top light, no directional shadow, light bouncing from all sides."
- **Props create clutter:** Add "props have breathing room, no overlapping main product, considered negative space."
- **Background goes neutral grey instead of pastel:** Add "blush pink or warm cream background, distinctly pastel not neutral."
- **Product gets lost among props:** Add "product is largest single element, clearly dominant, props secondary."
`,
};
