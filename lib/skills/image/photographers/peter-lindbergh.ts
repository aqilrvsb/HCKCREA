import type { Skill } from "../../types";

export const photographerPeterLindbergh: Skill = {
  id: "peter-lindbergh",
  kind: "photographer",
  tab: "image",
  title: "Peter Lindbergh — Desaturated Natural B&W High Fashion",
  triggers: [
    "peter lindbergh",
    "lindbergh",
    "desaturated fashion",
    "natural skin fashion",
    "b&w high fashion",
    "candid editorial",
    "humanist fashion",
    "no retouching fashion",
    "raw beauty editorial",
    "silver gelatin fashion",
  ],
  body: `# Peter Lindbergh — Desaturated Natural B&W High Fashion

## Photographer Identity
Peter Lindbergh is the antidote to artificial beauty. He shot fashion's most iconic models without retouching, refused to erase wrinkles, and treated fashion as a stage for authentic human presence. His B&W images are warm in tone (silver gelatin, not cool digital monochrome), loose in composition, and deeply candid in feel — even when meticulously set up. He is the reason "natural fashion photography" exists as a genre.

## Visual Signature
- **Lighting:** Soft overcast or diffused natural light; studio work mimics this. Flat, even, with gentle shadow modelling. No specular highlights on skin.
- **Colour:** B&W as primary language — warm silver-gelatin tone, not cold digital conversion. Colour work is heavily desaturated, almost monochrome.
- **Composition:** Loose, slightly off-axis, candid framing. Subjects caught mid-movement or mid-expression.
- **Skin:** Unretouched texture celebrated. Pores, lines, and imperfections are features, not faults.
- **Subjects:** Models, but with humanity restored — not mannequins.

## Prompt Phrase Library
1. "Peter Lindbergh-style B&W fashion, silver gelatin warmth, soft diffused light, natural unretouched skin"
2. "desaturated editorial fashion, humanist candid feel, loose composition, overcast light, no specular highlights"
3. "warm monochrome high fashion, subject mid-movement, natural expression, grain-heavy analog feel"
4. "natural skin editorial, pores and texture visible, flat diffused light, Lindbergh documentary fashion aesthetic"
5. "high fashion candid, woman on wind-swept location, B&W analog warmth, real body in motion"
6. "silver gelatin portrait, no retouching, genuine expression, soft shadow modelling, filmic grain"
7. "desaturated fashion editorial, almost-monochrome colour grade, loose framing, caught-in-motion feel"

## Best Model
**Banana Pro** — Lindbergh's atmospheric naturalism, grain texture, and environmental depth are Banana's native territory. Its multimodal reasoning handles the loose, candid framing without defaulting to hard-edge composition. GPT-2 over-retouches skin and fights the "natural imperfection" requirement even with explicit instruction.

## Subject Types
- **Portrait/Fashion:** Core domain — models, real people, faces with age and character
- **Editorial:** Magazine features, personal profiles, cultural figures
- **Lifestyle:** When lifestyle needs gravitas and documentary feel
- **Not ideal for:** Product close-ups, anything requiring pristine commercial finish, colour-accurate brand work

## Sample Full Prompt (Banana)
"A Malaysian woman in her late 30s, wearing a loose white linen shirt, standing on a windswept beach at overcast midday. She is mid-turn, hair partially across her face, looking slightly past camera with a distracted, genuine expression. Soft flat light from overcast sky, no shadows, no specular highlights on skin. B&W conversion with warm silver gelatin tone, not cold digital monochrome. Heavy film grain. Natural skin texture visible — pores, fine lines, no retouching. Loose candid framing, subject slightly off-center. Peter Lindbergh-style high-fashion documentary editorial. Medium-format analog feel, 80mm equivalent lens."

## Counter-Prompt Warnings
- **Banana defaults to even-skin beauty retouch:** Add "unretouched skin texture, pores visible, no smoothing, natural imperfections."
- **B&W converts too cold/digital:** Add "warm silver gelatin tone, not cold blue-black digital conversion."
- **Composition becomes too structured/centred:** Add "candid loose framing, subject slightly off-center, mid-gesture."
- **Grain disappears:** Add "heavy analog film grain, grain visible on skin and clothing."
`,
};
