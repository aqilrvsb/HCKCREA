import type { Skill } from "../../types";

export const scenePovDateNight: Skill = {
  id: "pov-date-night",
  kind: "scene",
  tab: "ugc",
  title: "POV: Date Night — 'POV: Korang Nak Pergi Date' Character-Driven",
  triggers: ["pov", "date night", "date", "going out", "korang nak pergi", "couple", "romantic", "evening out", "night out"],
  body: `# POV Date Night Scene

**Best for:** fashion, fragrance/perfume, skincare (pre-date prep), lingerie/modest fashion, jewellery, hair products, dining/restaurant promos, any product used in "going out" preparation.
**Best persona:** urban-hijabi-bestie, casual-bestie, inspirational-soft.
**Best voice:** achernar (female soft), iapetus (female Gen-Z), callirrhoe (female mid neutral).

## Setting block (paste into prompt body)
"Bedroom or dressing area, early evening. Creator in partial outfit — finishing getting ready. City lights or warm room lamp visible through window behind. Dressing table mirror, outfit hanging on door visible. Warm golden room light 2800K, city bokeh from window (soft blue contrast). Creator mid-preparation — applying perfume, adjusting outfit, checking mirror."

## Camera + framing
- Selfie POV handheld: "POV" means camera = the date's perspective — creator speaks directly to viewer as if they are the date.
- Phone held at arm's length, slightly below eye level, 35mm.
- Mirror selfie shot as alternative — creator catches reflection while preparing.
- 9:16 vertical. Natural handheld shake acceptable — romantic authenticity.

## Lighting
"Warm golden room lamp 2800K from camera-right (bedroom evening light). Cool city blue from window camera-left for natural contrast. Ring light: NOT ideal — too cold and clinical for date-night warmth. Aim: warm, flattering, slightly dramatic golden hour interior."

## Action beats (8s)
- 0–2s: Creator faces camera/viewer directly, slight shy smile. Hook line — addresses viewer as date directly. Mid-prep visible.
- 2–5s: Applies or shows product — perfume spray (wrist to neck), last makeup step, or puts on accessory. Product in natural context.
- 5–7s: Checks mirror, turns back, approving expression. "Ready" micro-moment. Product mentioned as reason for confidence.
- 7–8s: Picks up bag/keys, wink or soft smile to camera. CTA delivered as invitation, not sales pitch.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s, talking to "you"/the date):**
- "POV: korang dah tunggu kat bawah, aku siap jap ye."
- "Eh, jangan tengok lagi — aku belum ready. Jap... okay, done."
- "POV: korang ajak aku date, aku semangat sikit lebih dari biasa."

**Core (2-5s):**
- "Last step je ni — [PRODUCT] ni yang buat aku confident nak keluar malam."
- "Bau dia... korang kena datang dekat sikit untuk tahu. (wink)"
- "Kalau korang tanya aku pakai apa — ni la jawapannya. [PRODUCT]."

**Outro (7-8s):**
- "Okay ready — tekan beg kuning kalau korang nak smell macam ni jugak."
- "Jom? Link in bio — date pun akan tanya korang pakai apa."
- "Siap. Jangan lambat tunggu ye — [PRODUCT] je yang buat aku on time."

## Audio (5-layer)
- Dialogue: ONE speaker — intimate, slightly playful. Slightly softer than usual — confiding in camera.
- SFX: "perfume spray, jewellery clasp, heel click, zip of bag, makeup brush tap, keys jingle".
- Ambience: "evening room — distant city traffic, light wind, quiet room, occasional car below".
- Music: lo-fi RnB or soft trending love song, −16dB under dialogue. Can lift slightly during no-speech b-roll.
- Negatives: "no club/party music, no dramatic orchestra, no crowd".

## Veo prompt skeleton
"Selfie POV handheld, 35mm, creator faces camera as if addressing her date. <PERSONA_DESCRIPTOR> in bedroom getting-ready, warm golden room lamp from right, city window bokeh from left. Sprays <PRODUCT> (perfume/applies skincare), checks mirror, turns back with slight confident smile. He/She says: '<HOOK_LINE>'. SFX: perfume spray, keys jingle. Ambience: evening room quiet, distant city traffic. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- POV breaks → keep creator speaking to camera/viewer throughout, not breaking to address audience as audience.
- Room too dark → "warm golden room lamp at 80% brightness — not dim romantic, still clearly lit".
- Perfume spray invisible → add "mist visible in warm backlight — spray toward light source for visible mist trail".
- Outfit not visible → "medium close-up shows chest-up including outfit details — fashion product needs to show".
- CTA breaks POV immersion → integrate CTA into POV: "tekan beg kuning sebelum korang datang — aku tunggu."

## Persona + voice fit
- **urban-hijabi-bestie** + achernar: hijab date-night prep = high saves (modest fashion inspiration).
- **casual-bestie** + iapetus: Gen-Z date energy — playful, self-deprecating, relatable anxiety before date.
- **inspirational-soft** + callirrhoe: self-love date night — "solo date" variant also resonates.

## Cultural notes
- Malaysian POV format: "POV: korang" = dominant TikTok MY format hook — extremely high watch-through rate.
- Halal dating culture: modest framing — reference "dinner berdua", not club/bar. Conservative audience appreciates implicit modesty.
- Hijabi date fashion: full modest outfit styling during date-prep = huge saves category for MY women.
- Valentine's Day / 14 Feb: not celebrated uniformly — "malam jalan-jalan" framing is safer than "Valentine" explicitly for Muslim audience.
- Raya: pivot to "POV: korang nak pergi open house" — same format, festive context.
`,
};
