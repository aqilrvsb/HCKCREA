import type { Skill } from "../../types";

export const sceneVirtualTryOn: Skill = {
  id: "virtual-try-on",
  kind: "scene",
  tab: "ugc",
  title: "Virtual Try-On — Fashion Fit-Check",
  triggers: ["fashion", "fit-check", "outfit", "tudung", "hijab", "abaya", "mirror reveal", "ootd", "accessories", "bag"],
  body: `# Virtual Try-On Scene

**Best for:** hijab/tudung, modest fashion, abaya, jewelry, accessories, handbags, Raya outfits, office wear.
**Best persona:** Urban Hijabi Bestie, Casual Bestie, Polished Pro.
**Best voice:** callirrhoe (neutral confident), achernar (soft younger), iapetus (warm mid).

## Setting block (paste into prompt body)
"Bright bedroom or boutique changing room with a full-length mirror. Soft warm ambient light from a window or ring-lit vanity — no harsh shadows. Minimal background: a rack of clothes half-visible, or a plain pastel wall. Clean, relatable, aspirational-but-attainable."

## Camera + framing
- Front-facing mirror selfie, medium shot, phone visible in hand OR
- Static medium shot from tripod in bedroom/changing room facing subject.
- 9:16 vertical. 35mm natural lens feel, slight warmth.
- Detail close-up insert: jewellery, bag clasp, fabric texture for 1–2s cut-away.

## Lighting
"Soft warm ambient from camera-right window or vanity strip-light. Slight golden tone on skin. No softbox studio flatness — bedroom / boutique feel."

## Action beats (8s)
- 0–2s : Subject holds outfit on hanger in front of body OR stands in pre-outfit look, direct-to-camera glance, hook line.
- 2–5s : "Putting on" transition — quick cut or whip-pan to subject now wearing the item. Close-up of detail (fabric drape, pin, clasp).
- 5–7s : Slow twirl OR angled mirror shot OR detail sweep. Subject smiles or reacts — "nampak slim kan?".
- 7–8s : Confident final pose, product/label visible, caption tease outro.

## Dialog patterns (Malay/EN code-switch)
**Opener:**
- "Korang, ni baju Raya aku tahun ni — jap tengok dulu."
- "Okay jap, akak nak tunjuk something. Tudung ni memang padu gila."
- "POV: dapat outfit cantik tapi kena try dulu sebelum confirm."

**Core:**
- "Material dia lembut, tak nampak labuh sangat — confirm boleh pakai office atau event."
- "Warna dia neutral, cantik untuk wedding guest. Nampak slim pun, gila tak?"
- "Akak dah try macam-macam abaya, yang ni je memang settle — potongan dia perfect."

**Outro:**
- "Link ada kat beg kuning, size aku M — korang boleh refer chart dia."
- "Kalau korang suka, tekan beg kuning sebelum habis stok tau."
- "Rating aku 9/10. Minus satu sebab nak beli lagi tiga kaler lain."

## Audio (5-layer)
- Dialogue: ONE voice, conversational mirror-selfie energy.
- SFX: "soft fabric swish on turn, light hanger clink, zip or clasp click, heel tap on floor".
- Ambience: "quiet bedroom hum, faint air-cond, distant mall murmur if boutique setting".
- Music: soft lo-fi R&B or light pop underscore — low, not distracting.
- Negatives: "no fashion show runway music, no crowd applause, no loud upbeat pop".

## Veo prompt skeleton
"Static medium shot, 35mm, warm ambient light. <PERSONA_DESCRIPTOR> stands in a bright bedroom changing room holding <PRODUCT> on a hanger in front of her body. Quick cut: she now wears <PRODUCT>, does a slow half-twirl toward the mirror, glances at camera. She says: '<HOOK_LINE>'. Soft window-light from camera-right, slight golden tone. SFX: fabric swish, light hanger clink. Ambience: quiet room hum. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes (and fixes)
- Wrong body framing → add "medium shot from waist-up minimum, full body preferred for outfit reveal — do NOT crop below knee".
- Flat uninspired look → add "subject reacts with genuine delight — slight smile, eyebrow raise, self-approving nod".
- Studio look creeping in → add "bedroom or boutique setting with real furniture, NOT a white studio backdrop".
- Outfit not visible → add "full garment clearly shown — no obstructions, product drape and colour accurate".
- Hijab accuracy loss → add "hijab pinned neatly, no hair visible, modest styling consistent throughout".

## Cultural notes
- Raya season demand spikes — include "Raya fit", "baju raya" trigger language March–April.
- Hijabi content: maintain modest styling through ALL frames including transition cuts.
- "Nampak slim" framing resonates strongly — body-positive but silhouette-flattering angle.
`,
};
