import type { Skill } from "../../types";

export const compositeVirtualTryOn: Skill = {
  id: "virtual-try-on",
  kind: "composite",
  tab: "image",
  title: "Virtual Try-On — Outfit Composite Multi-Garment Refs",
  triggers: [
    "virtual try on",
    "outfit composite",
    "garment composite",
    "clothing try on",
    "fashion composite",
    "model wearing outfit",
    "dress model in outfit",
    "outfit on character",
    "clothing reference composite",
    "fashion try on ai",
  ],
  body: `# Virtual Try-On — Outfit Composite Multi-Garment Refs

## Use Case
You have garment images (top, bottom, outerwear, accessories) and want to dress a character — either a reference character or a generated model — in those exact garments, maintaining fabric texture, colour, and design fidelity.

## Reference Image Setup
- **Slot 1:** Character reference OR "generate a [Malay/hijabi] model" — the body receiving the garments
- **Slot 2:** Primary garment (top, dress, abaya) — the most important piece
- **Slot 3:** Secondary garment (bottom, hijab, outerwear) — if multi-piece
- **Slot 4-16 (GPT-2 up to 16):** Accessories, shoes, additional pieces
- **Note:** GPT-2 supports up to 16 refs; Banana Flash supports 3, Pro tier supports 14

## Model Choice
**GPT Image 2 (primary recommendation for virtual try-on)**
- \`input_fidelity="high"\` is decisive for garment texture and design preservation
- Instruction-following (1512 ELO) handles precise "dress this body in these garments" logic
- 16-ref input allows full outfit multi-piece with accessories
- Native understanding of garment-body spatial relationship
- Best for: E-commerce fashion, modest fashion multi-piece, detailed fabric preservation

**Banana Pro (fallback for atmospheric lifestyle context)**
- Use when the try-on output needs editorial atmosphere, not e-commerce precision
- Better for: Editorial fashion in natural setting, Malay/hijabi lifestyle scenes
- Limitation: 3-ref (Flash) or 14-ref (Pro) max; garment fidelity lower than GPT-2

## Full Prompt Template (GPT-2)
\`\`\`
Scene: [Clean white studio / lifestyle setting — sunlit room / outdoor urban]
Subject: A [Malay/hijabi/Southeast Asian] woman, [age range], [body type descriptor], wearing the outfit from the reference images.
Important details:
  - Primary garment: [exact description — "the cobalt blue abaya from ref 2, fabric drape and embroidery exactly preserved"]
  - Secondary garment: [exact description — "the cream silk hijab from ref 3, wrap style and volume preserved"]
  - Accessories: [if provided — "the gold chain from ref 4"]
  - Fabric fidelity: all texture, colour, pattern, and design details from reference images preserved exactly
  - Fit: garments fitting [naturally / fitted / draped] on the model's body
  - Pose: [standing full-body / 3/4 turn / walking toward camera]
  - Lighting: [soft studio / natural window / golden outdoor]
Use case: Fashion e-commerce product listing / editorial lookbook / social media campaign
Constraints: No garment design elements changed. No fabric colour shifted. Hijab coverage preserved exactly. No logos or text altered. No extra garments added. Model's face [from reference / as generated].
\`\`\`

## GPT-2 Edit Prompt Pattern (when editing existing try-on)
1. **What changes:** "Replace the trousers with the wide-leg linen pants from the new reference image."
2. **What stays locked:** "Preserve the top garment, hijab, shoes, lighting, and model identity exactly as in the current image."
3. **Physical realism:** "Match the new trouser fabric drape and shadow to the existing lighting direction and model stance."

## input_fidelity Setup (GPT-2)
Always set \`input_fidelity="high"\` in the API call for virtual try-on composites. This parameter tells GPT-2 to weight reference image features more heavily than its own generative defaults — critical for exact fabric pattern preservation.

## Common Failure Modes + Fixes
| Failure | Fix |
|---|---|
| Garment colour shifts (especially in AI) | Add "preserve exact fabric colour from reference — [describe hex or exact colour name]" |
| Fabric pattern/embroidery lost | Add "embroidery, print, and surface pattern detail from reference image exactly preserved" |
| Hijab coverage reduced | Add "hijab coverage exactly as in reference — full neck and chest coverage, no hair visible" |
| Garment fit looks wrong on body | Add "garment draping naturally on body with correct fabric weight and fall" |
| Multiple garments conflict | Process one garment at a time if conflict occurs — layer sequentially |
| Model face not matching reference | Set \`input_fidelity="high"\` and place character reference as Slot 1 explicitly |
| Background competes | Add "clean [white / lifestyle] background, garments and model are the only subject" |
`,
};
