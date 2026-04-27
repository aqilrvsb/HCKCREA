import type { Skill } from "../../types";

export const sceneUnboxing: Skill = {
  id: "unboxing",
  kind: "scene",
  tab: "ugc",
  title: "ASMR Unboxing — Hands + Packaging, Satisfying Sounds",
  triggers: ["unboxing", "unbox", "package", "parcel", "delivery", "open box", "packaging", "haul", "shipping"],
  body: `# ASMR Unboxing Scene

**Best for:** e-commerce products of all categories — beauty, tech, fashion, food, supplements, any product shipped in packaging. Especially powerful for 11.11/12.12 haul content.
**Best persona:** casual-bestie, urban-hijabi-bestie, chinese-malaysian-codeswitcher.
**Best voice:** iapetus (female Gen-Z), achernar (female soft), callirrhoe (female mid neutral).

## Setting block (paste into prompt body)
"Flat surface — white table, wooden floor, or bed surface. Shipping box/mailer bag in centre frame. Hands-only or hands + face (chest-up). Natural daylight or warm LED overhead. Scissors, box cutter nearby as props. Clean surface with minimal clutter. Parcel sticker/tracking label visible before opening — authenticates real delivery."

## Camera + framing
- Overhead top-down on tripod for hands-only unboxing — pure ASMR format.
- Selfie POV chest-up for face-reaction hybrid format — hands unbox at chest level.
- 9:16 vertical. 35mm natural. Slight handheld shake on face cam = authentic parcel excitement.
- Transition: start overhead, cut to face-cam for reaction beat at product reveal.

## Lighting
"Natural window diffused (5500K) or warm LED overhead panel (3500K). Overhead for top-down: single overhead directly above, no shadows obscuring box. Face-cam: front-facing LED panel or ring light. ASMR format: no harsh shadows across packaging text."

## Action beats (8s)
- 0–2s: Box/parcel in frame. Hook line ("Parcel sampai!"). Hands enter, inspect label — anticipation build.
- 2–4s: Open packaging — tape peel, box flap fold, tissue paper rustle, airbag pop. Each sound deliberate.
- 4–6s: Product revealed from packaging — held up, rotated slowly, examined. First impression reaction.
- 6–8s: Product opened/tested on skin/used briefly. Verdict delivered. CTA.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Parcel! — korang tau rasa tu tak, bila parcel sampai?"
- "Okay jom unbox sama-sama — aku dah tunggu ni seminggu."
- "Shopee/Lazada just dropped — jom tengok apa aku beli."

**Core (4-6s, product reveal):**
- "Eh packaging dia cantik gila — aku tak expect langsung. Premium feel."
- "First impression: bau dia best, texture dia macam yang aku expect dari reviews."
- "[PRODUCT] ni — korang yang recommend kat comment section dulu. Jom test."

**Outro (6-8s):**
- "Worth it. Tekan beg kuning — aku dah link semua dalam bio."
- "Confirm order lagi — korang pun patut try. Halal, free delivery."
- "Rate dia? 9/10. Tu je — link in bio."

## Audio (5-layer)
- Dialogue: ONE speaker — genuine excitement, variable pace (slows on key reveals, speeds during anticipation).
- SFX: "packing tape peel, box creak, cardboard fold, tissue paper crinkle, airbag pop, product cap click, shrink wrap tear".
- Ambience: "home delivery moment — doorbell faint distance, home ambient quiet, AC low hum".
- Music: trending TikTok Shop haul BGM, −16dB under dialogue. Surface music during non-speech B-roll.
- Negatives: "no overproduced studio packaging sounds, no crush/damage sounds, no background TV".

## Veo prompt skeleton
"Overhead top-down locked then cut to selfie POV chest-up. Hands on white table. Shipping box with tracking label visible. Hands peel tape — slow deliberate. Box open, tissue paper reveal. <PRODUCT> lifted from box — rotated slowly. Face-cam cut: <PERSONA_DESCRIPTOR> holds product up, genuine first-impression expression. He/She says: '<HOOK_LINE>'. Natural window diffuse 5500K overhead + face-cam front LED. SFX: tape peel, tissue crinkle, cap click. Ambience: home quiet, AC hum. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Packaging sounds too quiet → specify "SFX foreground mix — tape peel at 0dB, room ambience at −24dB".
- Product reveal underwhelming → add "brief pause before product exits box — one beat of suspense, then reveal".
- Delivery context unclear → keep tracking label visible: "Shopee/Lazada/J&T sticker on outer box — authenticates real order".
- Creator excitement too flat → "lean into initial 'ooh' sound, eyebrow raise, slow appreciation nod on reveal".
- Packaging destroys itself during open → specify "creator cuts tape cleanly with scissors — packaging stays intact for hero shots".

## Persona + voice fit
- **casual-bestie** + iapetus: highest energy, Gen-Z parcel excitement — "#paketdatang" culture.
- **urban-hijabi-bestie** + achernar: beauty/fashion unboxing — premium feeling, saves-driven.
- **chinese-malaysian-codeswitcher** + callirrhoe: 11.11/12.12 haul energy — "11.11 haul dah sampai!" angle.

## Cultural notes
- 11.11/12.12 mega sale: unboxing is THE format — highest-performing period for this scene type.
- Shopee/Lazada branding: show platform delivery bag/sticker — familiar trust anchor for Malaysian buyers.
- Halal products: if unboxing skincare/food, show halal cert/logo immediately on first product reveal.
- Bubble wrap/airbag pop = universal satisfaction moment — never cut before the pop.
- Raya: "unboxing baju raya" variation drives massive saves in March-April period.
`,
};
