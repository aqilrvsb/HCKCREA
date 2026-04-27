import type { Skill } from "../../types";

export const compositeAmazonListing: Skill = {
  id: "amazon-listing",
  kind: "composite",
  tab: "image",
  title: "Amazon Listing — 7-Image Chain Banana Dual-Reference",
  triggers: [
    "amazon listing photos",
    "e-commerce listing images",
    "product listing chain",
    "7 image listing",
    "lazada listing photos",
    "shopee listing images",
    "product photography set",
    "listing image workflow",
    "e-commerce product chain",
    "multi-angle product listing",
  ],
  body: `# Amazon Listing — 7-Image Chain Banana Dual-Reference

## Use Case
Generate a complete 7-image e-commerce product listing set from a single product reference — the standard format for Amazon, Lazada, and Shopee main listings. Each image serves a specific conversion role in the listing stack.

## The 7-Image Stack (Listing Role Order)
| Position | Image Type | Conversion Role |
|---|---|---|
| 1 | Hero white background | Primary search result thumbnail |
| 2 | Lifestyle in-context | "Imagining using this" trigger |
| 3 | Close-up detail shot | Materials/quality reassurance |
| 4 | Scale/size reference | "Will this fit my life" confirmation |
| 5 | Benefit infographic | Key features without reading text |
| 6 | Multi-variant or multi-use | Product family / versatility signal |
| 7 | Packaging + unboxing | Brand premium and gift suitability |

## Reference Image Setup (Dual-Reference Method)
- **Slot 1 (Product):** Clean product image — primary reference locked for all 7 images
- **Slot 2 (Scene/context):** Lifestyle scene reference OR brand style reference (for consistent background world)
- **Keep both references loaded for the entire conversation chain** — Banana's conversational consistency maintains product fidelity across all 7 prompts in one session

## Model Choice
**Banana Pro (primary — conversational chain method)**
- Conversational chain consistency: Product Slot 1 reference persists across all prompts in same session
- Atmospheric lifestyle rendering for images 2, 4, 6
- Multi-ref dual-anchor for product + scene lock
- Speed (5-10s/image) makes iteration fast
- **Critical rule:** Generate all 7 in one conversation. Starting a new conversation breaks product consistency.

**GPT-2 (for image 5 and 7 only — infographic + text)**
- Image 5 (benefit infographic): GPT-2's text rendering (95%+) and structured visual reasoning are decisive
- Image 7 (packaging with brand name): If brand name must be exactly readable on packaging, use GPT-2
- Route images 1-4, 6 to Banana; images 5 and 7 to GPT-2

## Dual-Reference Anchor Phrase (Banana — paste at start of EVERY prompt in chain)
> "Using the product from the attached reference image and the scene world from the second reference, keep the product appearance — shape, label, colour, and proportions — exactly consistent with the reference throughout this conversation."

## Prompt Templates for Each Image

**Image 1 — Hero White:**
"[ANCHOR PHRASE] Studio hero shot: product centered on pure white infinity background, product filling 70% of frame, 45-degree angle, three-point edge lighting, label fully visible and readable, no props, no context, clean drop shadow beneath product."

**Image 2 — Lifestyle:**
"[ANCHOR PHRASE] Lifestyle scene: product being used by a [Malay/hijabi] woman in her [30s] in a [warm kitchen / sunlit bathroom / tidy desk setup]. Natural indirect light. Product held or placed naturally. Background soft-focus. [MUJI aesthetic / Kinfolk aesthetic / warm editorial]."

**Image 3 — Close-Up Detail:**
"[ANCHOR PHRASE] Macro detail shot: extreme close-up of [product's key material feature — texture, label detail, cap mechanism, fabric weave]. Fill the entire frame. Sharp focus on surface. Studio softbox overhead. Show material quality."

**Image 4 — Scale Reference:**
"[ANCHOR PHRASE] Scale context shot: product placed beside a familiar reference object — [a standard coffee mug / a human hand / an A4 notebook]. Natural desktop setting. Proportions clearly show product size. Soft natural light."

**Image 5 — Benefit Infographic (route to GPT-2):**
"Scene: White or brand-colour background. Subject: Product image on left half, 3 benefit callouts on right half with icons. Important details: Benefit text (EXACT): '[Benefit 1]', '[Benefit 2]', '[Benefit 3]'. Bold sans-serif font, high contrast, clean layout. Use case: E-commerce infographic slide. Constraints: Text verbatim. No extra words."

**Image 6 — Multi-variant:**
"[ANCHOR PHRASE] Flat-lay of 3 product variants (colour A, colour B, colour C) arranged diagonally on [linen / marble / warm wood] surface. Each product's label visible. Soft natural top light. Clean and organised layout."

**Image 7 — Packaging (route to GPT-2 if text-critical):**
"Scene: Clean lifestyle surface — warm wood or marble. Subject: Product in its packaging box, box open at 45 degrees showing product inside, product beside box. Important details: Brand name on box exactly readable, premium unboxing feel, soft warm light. Use case: Premium gifting and packaging shot. Constraints: Brand name text verbatim. No smudging."

## Common Failure Modes + Fixes
| Failure | Fix |
|---|---|
| Product drifts after image 3 | Do not start new conversation — stay in same session; re-attach reference if drift occurs |
| Label becomes illegible | Add "label facing camera directly, text fully readable, no foreshortening" |
| Lifestyle scene overwhelms product | Add "product is the primary subject, lifestyle elements are secondary and softer" |
| Infographic text errors | Route to GPT-2 for image 5; describe exact text in quotes with "render verbatim" |
| Inconsistent lighting across set | Add same lighting descriptor to every prompt in chain: "consistent soft natural window light from left" |
`,
};
