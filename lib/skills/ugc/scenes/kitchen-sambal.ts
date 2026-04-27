import type { Skill } from "../../types";

export const sceneKitchenSambal: Skill = {
  id: "kitchen-sambal",
  kind: "scene",
  tab: "ugc",
  title: "Kitchen / Sambal — Malay home cooking",
  triggers: ["kitchen", "sambal", "cooking", "food", "malay home", "ibu", "auntie", "halal food"],
  body: `# Kitchen Sambal Scene

**Best for:** halal food products, sauces, sambal, ready-to-eat, snack reveal, condiments, kitchen tools.
**Best persona:** Ibu Muda, Mak Cik Converter, Casual Bestie (for younger demos).
**Best voice:** enceladus (mom-warm), callirrhoe (neutral mid), achernar (younger soft).

## Setting block (paste into prompt body)
"Bright Malaysian home kitchen at mid-morning. Ceramic-tile backsplash, rattan placemat on a wooden countertop, gas stove with one pan visible. Soft window-light from camera-left, faint shadow of leaves on the wall. Pandan leaves and a halved chili in shot for natural cooking context."

## Camera + framing
- Selfie POV chest-up, phone at arm's length OR
- Overhead top-down for product texture / pour shots OR
- Static medium close-up tripod on counter (best for talking-head dialog).
- 9:16 vertical. 35mm or 50mm natural lens feel.

## Lighting
"Soft window-light from camera-left, warm tungsten fill from extractor hood. No softbox studio look — natural mixed kitchen light."

## Action beats (8s)
- 0–2s : Subject lifts product, brief direct-to-camera glance, hook line.
- 2–5s : Pours / spoons / spreads product onto food. Sizzle or texture moment.
- 5–7s : First taste reaction — eyes close, slight nod, smile.
- 7–8s : Hold product label toward camera, soft outro line.

## Dialog patterns (Malay/EN code-switch)
- Hook: "Korang tau tak, sambal ni..." / "Akak nak share rahsia dapur akak."
- Core: "Aku try last week — confirm sedap gila, anak-anak pun habis nasi."
- Outro: "Tekan beg kuning, halal je tau."

## Audio (5-layer)
- Dialogue: ONE voice only.
- SFX: "sizzle of oil hitting pan, soft clink of spoon on ceramic plate, crisp rip of pouch packaging".
- Ambience: "low extractor-fan hum, distant kettle whistle, light morning chatter from another room".
- Music: none, or very low warm guitar.
- Negatives: "no audience, no laugh track, no music score".

## Veo prompt skeleton
"Selfie POV medium close-up, 35mm. [Persona descriptor] in a bright Malaysian home kitchen at mid-morning, holds [PRODUCT description]. She pours [product] onto rice on a ceramic plate, takes a small bite, eyes close briefly. She says: '<HOOK_LINE>'. Soft window-light from camera-left, warm tungsten fill from extractor hood. SFX: oil sizzle on pan, soft ceramic clink. Ambience: low fan hum, distant kettle. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes (and fixes)
- Plastic skin → add "natural skin texture with pores, slight T-zone shine, no airbrushing".
- Wrong language audio → add "speaks in Malay" + give exact quoted line.
- Studio look creeping in → add "lived-in kitchen with minor clutter, NOT a softbox studio".
- Halal trust gap → ensure halal logo or clear non-pork/non-alcohol context visible.

## Cultural notes
- Halal logo visible in first 5s drives MASSIVE trust for Muslim audience.
- Avoid mukbang during Ramadan daylight — pivot to "berbuka" (breaking fast) framing instead.
- Auntie / Ibu persona crushes 30-55 demographic; Casual Bestie wins 18-28.
`,
};
