import type { Skill } from "../../types";

export const sceneAsmrProduct: Skill = {
  id: "asmr-product",
  kind: "scene",
  tab: "ugc",
  title: "ASMR Product — Top-Down Macro, No Dialog, Packaging Sounds",
  triggers: ["asmr", "packaging", "texture", "macro", "top down", "satisfying", "unboxing sounds", "product sounds", "no dialog"],
  body: `# ASMR Product Scene

**Best for:** skincare, cosmetics, food/snack packaging, stationery, tech accessories, any product with interesting packaging sounds, textures, or visual reveals.
**Best persona:** product-whisperer (voice-over optional), no on-screen persona — product IS the star.
**Best voice:** achernar (female soft, whisper mode if any VO), callirrhoe (female mid neutral whisper).

## Setting block (paste into prompt body)
"Clean flat-lay surface — white marble, light wood, or matte concrete. Top-down overhead locked camera. Product centred in frame with 20% negative space on all sides. Natural daylight from a north-facing window (even, cool-diffused, no direct sun beam). No human hands in frame initially — product exists alone."

## Camera + framing
- Overhead top-down LOCKED on tripod — zero drift, zero shake.
- Macro B-roll: camera 5-8cm from product surface for texture/detail shots.
- 9:16 vertical (rotate to portrait for top-down — tripod arm extended over surface).
- 50mm macro or 85mm compressed equivalent. Shallow depth of field (f/2.8) for texture isolation.

## Lighting
"Diffused north-facing window light (5500K cool-natural, very even). Optional: single white bounce card on shadow side. NEVER use direct sun (harsh shadows kill texture detail). Ring light is acceptable ONLY for macro close-ups — not for full overhead composition."

## Action beats (8s)
- 0–2s: Product rests alone in frame. One hand enters, gently touches packaging. First sound — crinkle, tap, or foil rustle.
- 2–4s: Slow unbox/open sequence — peel tab, twist cap, slide lid. Each action generates signature sound.
- 4–6s: Product interior/texture reveal — cream swirl, powder sift, liquid pour. Maximum sensory visual.
- 6–8s: Product reassembled or elegantly resting. Final tap or press. Title card or whisper CTA (optional).

## Dialog patterns (no on-screen speech — whisper VO or title card only)
**Hook title card (0-2s):**
- "ASMR: [PRODUCT] first open"
- "Let your ears decide..."
- "Bunyi yang korang tunggu-tunggu..."

**Core (optional whisper VO, 2-5s):**
- "(whisper) Texture dia... smooth gila. Tengok."
- "(whisper) Tak sangka packaging dia pun best macam ni."
- "(whisper) Satu kali bukak — terus tahu quality dia."

**Outro title card (7-8s):**
- "Tekan beg kuning ↓"
- "Link in bio — free delivery"
- "Satisfy your ears AND your skin."

## Audio (5-layer)
- Dialogue: NONE or whisper VO max — product sounds are the hero audio.
- SFX: "foil crinkle, cardboard slide, plastic snap, cap pop, cream on skin (wet squish), powder tap, glass tap — all at 0dB, no compression".
- Ambience: "near-silent room — distant birdsong max, no AC hum, no traffic".
- Music: NONE. Music kills ASMR. Maximum: 2-bar ambient drone at −30dB.
- Negatives: "no music, no dialogue, no room noise, no echo or reverb on product SFX".

## Veo prompt skeleton
"Overhead top-down locked camera, 50mm macro, f/2.8. Clean marble flat-lay surface. <PRODUCT> centred in frame. Hand enters slowly, peels open packaging — foil crinkle. Lifts lid — pop. Exposes cream/liquid/powder interior — swirl or pour. Taps product gently. Near-silent room ambience. SFX: foil crinkle, cap pop, cream texture, glass tap — all foreground. Optional whisper VO: '<HOOK_LINE>'. Diffused north-window light 5500K, white bounce card right. 9:16."

## Common failure modes + fixes
- Camera wobble ruins overhead → add "camera LOCKED — zero movement between all cuts. Tripod arm overhead rig only".
- Sounds missing/thin → specify each sound individually in SFX: "1. foil tear, 2. lid pop, 3. cream squish — all recorded at 0dB".
- Lighting creates harsh shadows → "north-facing diffused light only — no direct sun beam, no single-point overhead".
- Product looks staged/clinical → add "slight natural imperfection — one fingerprint on lid, minor packaging wear".
- VO breaks ASMR spell → if using voice, specify "barely-audible whisper, lips close to mic, no breath pop".

## Persona + voice fit
- **product-whisperer** (no persona needed on-screen) + achernar whisper: purest ASMR format.
- **educational-expert** + callirrhoe: if switching to soft explainer hybrid (texture + ingredient VO).
- No on-screen persona is valid and preferred for pure ASMR format.

## Cultural notes
- ASMR penetration in MY is growing fast — largely female 18-30 audience, premium product tier.
- Works well for high-SKU products where sensory experience is a buying signal (skincare, premium food).
- Halal relevance: no specific concerns — no person, no food, no prayer context. Clean format.
- 11.11/12.12: ASMR "gift wrap" variation (product in gift box ASMR open) = seasonal high-converter.
- Use close-caption title cards in BM for product name — silent video must be text-accessible.
`,
};
