import type { Skill } from "../../types";

export const sceneMomMorningRoutine: Skill = {
  id: "mom-morning-routine",
  kind: "scene",
  tab: "ugc",
  title: "Mom Morning Routine — Hijabi Mum, Dawn Kitchen",
  triggers: ["mom", "morning routine", "kitchen", "hijabi", "ibu", "mother", "kids", "family", "sahur", "breakfast", "routine"],
  body: `# Mom Morning Routine Scene

**Best for:** kitchen products, health supplements, instant food, family-oriented FMCG, cleaning products, children's nutrition, modest fashion accessories.
**Best persona:** ibu-muda, mak-cik-converter, enceladus voice persona.
**Best voice:** enceladus (female mom-warm), callirrhoe (female mid neutral), achernar (female soft younger).

## Setting block (paste into prompt body)
"Malaysian home kitchen at early dawn, 5:30–6:30am. Warm incandescent kitchen light, slightly blue ambient through window (pre-sunrise). Rice cooker steaming, lunchboxes open on counter. One or two children's voices audible in background but not visible. Hijabi creator in telekung or simple baju kurung, minimal makeup."

## Camera + framing
- Static medium close-up on tripod or propped on counter — no selfie POV, slightly more composed than pure UGC.
- Phone at counter level looking up slightly — creator appears multi-tasking, natural glances to camera.
- Overhead shot (second angle) for food/product prep close-up.
- 9:16 vertical. 35mm natural. Slight warm colour grade baked in.

## Lighting
"Warm incandescent kitchen overhead (2700K dominant). Pre-dawn blue ambient from window creates natural colour contrast. No supplemental lighting — real home kitchen look. If too dark, add 'small warm LED strip under upper cabinet from camera-left'."

## Action beats (8s)
- 0–2s: Creator already mid-task (packing lunchbox or stirring pot), glances to camera — hook in medias res. Doesn't pause routine.
- 2–5s: Introduces product as part of natural routine — pours, scoops, or packs product while still doing morning tasks.
- 5–7s: Brief pause to face camera directly — shares result/benefit with warmth and sincerity.
- 7–8s: Returns to task or picks up child's item — CTA delivered while moving. Authentic busyness.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Subuh-subuh dah busy, tapi takkan skip [PRODUCT] — ni non-negotiable untuk akak."
- "Korang, pagi buat apa? Aku tengah pack bekal anak sambil share ni."
- "5am, dapur dah panas — tapi dengan [PRODUCT] ni lagi semangat sikit."

**Core (2-5s):**
- "Anak-anak akak memang suka — confirmed habis dalam masa seminit, tak payah paksa."
- "Akak bubuh dalam air suam je, senang — anak minum sambil tunggu sekolah."
- "Dah 2 bulan pakai, berat badan pun maintain — jimat masa, jimat usaha."

**Outro (7-8s):**
- "Tekan beg kuning ibu-ibu — free delivery, halal cert ada tau."
- "Akak dah order stok bulan depan — korang pun perlu try."
- "Untuk ibu yang busy macam kita — ni life-saver dia."

## Audio (5-layer)
- Dialogue: ONE speaker — warm maternal tone, slightly hushed (kids sleeping or just waking).
- SFX: "rice cooker pop, lunchbox snap, tap water, spoon in pot, telekung fabric rustle".
- Ambience: "pre-dawn quiet — distant azan faint (optional, powerful trust signal), children's low voices off-camera, clock tick".
- Music: none, or very soft nasyid at −22dB ghost level.
- Negatives: "no loud music, no TV noise, no dog sounds".

## Veo prompt skeleton
"Static medium close-up, 35mm, phone on counter looking up slightly. <PERSONA_DESCRIPTOR> in hijab and simple home outfit in warm Malaysian kitchen at pre-dawn, packing lunchboxes and cooking simultaneously. Introduces <PRODUCT> naturally into routine — scoops, pours. Glances at camera. He/She says: '<HOOK_LINE>'. Warm 2700K kitchen overhead, pre-dawn blue through window. SFX: rice cooker, lunchbox snap, spoon. Ambience: pre-dawn quiet, children distant. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Kitchen looks too staged → add "real kitchen — some dishes in sink, magnets on fridge, kids artwork on wall".
- Kids visible and distracting → specify "children's voices only — no children visible in frame".
- Creator looks too put-together → "minimal makeup, simple hijab, home baju kurung — pre-going-out look".
- Azan usage: azan in background = strong Muslim trust signal but must be used respectfully — not as BGM.
- Product integration feels forced → script the hand choreography: "stirs product into cup while still watching stovetop".

## Persona + voice fit
- **ibu-muda** + enceladus: core persona for this scene — young mother warmth, relatable overwhelm → solution arc.
- **mak-cik-converter** + callirrhoe: older mother endorsement — higher trust with 35-50 demographic.
- **inspirational-soft** + achernar: younger mom aspirational take — "how I keep it together as a working mum".

## Cultural notes
- Sahur (pre-dawn Ramadan meal): this scene format hits PEAK engagement during Ramadan — highest relevance period.
- Halal + family trust: products shown in family morning context have highest purchase intent from Malaysian mothers.
- Ibu + halal cert = strongest conversion combo in Malaysian TikTok Shop — always show logo.
- Avoid: pork products, non-halal animal images, alcohol anywhere near children's scene.
- CNY season: swap to "pagi raya" or add ketupat/kuih in background for festive variation.
`,
};
