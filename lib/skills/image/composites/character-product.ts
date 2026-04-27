import type { Skill } from "../../types";

export const compositeCharacterProduct: Skill = {
  id: "character-product",
  kind: "composite",
  tab: "image",
  title: "Character + Product Composite — Identity + Product Preserved",
  triggers: [
    "character holding product",
    "person with product",
    "model with product",
    "character product composite",
    "ugc character product",
    "lifestyle model product",
    "face with product",
    "influencer product shot",
    "character reference composite",
    "model holding item",
  ],
  body: `# Character + Product Composite — Identity + Product Preserved

## Use Case
You have a character reference image (face/identity) and a product image. Goal: generate a realistic image of THAT person holding, using, or positioned with THAT product — with both identity and product preserved faithfully.

## Reference Image Setup
- **Slot 1 (Primary):** Character reference — clear face, front or 3/4 angle, good lighting. This locks identity.
- **Slot 2 (Secondary):** Product reference — clean product shot, label visible if relevant.
- **Optional Slot 3:** Scene/background reference to lock the environment.

## Model Choice
**Banana Pro (primary recommendation)**
- Native multi-image input (up to 14 refs, Flash tier: 3)
- Atmospheric photorealism handles lifestyle context naturally
- Character consistency stronger than GPT-2 in 3+ ref scenarios
- Best for: UGC lifestyle, editorial, Malay/hijabi character fidelity

**GPT Image 2 (when identity is secondary or product text is critical)**
- \`input_fidelity="high"\` locks referenced identity in /edit endpoint
- Use when product label must be exactly readable
- Use when background is a structured scene requiring precise spatial planning

## Full Prompt Template (Banana)
\`\`\`
[CHARACTER ANCHOR] Take the face from the attached reference photo as the primary identity reference. Keep facial features exactly consistent with this reference throughout all variations.

[PRODUCT ANCHOR] Use the product from the second attached image as the exact product reference — preserve label, shape, and colour accurately.

[SCENE] A [Malay/hijabi/Southeast Asian] woman in her [age range], [clothing description], [action: holding / using / displaying] the [product name] [action detail: "raised toward camera showing label" / "held at chest height" / "placed on table beside her"]. [Setting: sunlit skincare studio / warm kitchen counter / outdoor market / clean white background].

[LIGHTING + STYLE] [Mario Testino warm editorial / MUJI natural indirect / Vogue Arabia dramatic / Annie Leibovitz environmental] — [lighting descriptor]. [Camera: 85mm portrait lens, slight depth of field on background].

[PRODUCT VISIBILITY] Product label fully visible and readable. Product scale proportional to character. Natural hand grip.
\`\`\`

## Reference Image Anchor Phrase (Banana)
> "Take the face from the attached reference photo as the primary identity reference. Keep facial features exactly consistent with this reference throughout all variations."

Place this as the FIRST sentence of the prompt. Banana weights prompt-start elements highest.

## GPT-2 Edit Prompt Pattern
1. **What changes:** "Place [character] holding [product] at chest height in a sunlit lifestyle setting."
2. **What stays locked:** "Preserve the character's facial features, skin tone, and hijab exactly as in the reference image. Preserve product label text and shape exactly."
3. **Physical realism:** "Match the product shadow and highlight to the ambient lighting direction. Scale product realistically to hand size."

## Common Failure Modes + Fixes
| Failure | Fix |
|---|---|
| Character face drifts (Banana) | Add "Keep facial features exactly consistent with this reference" + restart conversation if 5+ edits deep |
| Product label unreadable | Switch to GPT-2 with \`input_fidelity="high"\` or describe label text in quotes |
| Hand grip looks unnatural | Add "natural relaxed hand grip, fingers wrapped organically around product, not floating" |
| Product scale wrong | Add "product scale proportional — [product name] approximately [palm-sized / forearm length]" |
| Character skin tone shifts | Add "preserve original skin tone exactly — warm [medium brown / deep brown / fair] — no brightening" |
| Hijab/headscarf disappears | Add "hijab or headscarf exactly as in reference — fabric folds, colour, and coverage preserved" |
| Background competes with subject | Add "background softly blurred, subject and product in sharp focus, background secondary" |
`,
};
