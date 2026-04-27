import type { Skill } from "../../types";

export const sceneTalkingProduct3d: Skill = {
  id: "talking-product-3d",
  kind: "scene",
  tab: "ugc",
  title: "Talking Product 3D — AI-Animated Product with Voice & Gestures",
  triggers: ["talking product", "3d product", "animated product", "product talks", "product character", "ai animation", "product personality"],
  body: `# Talking Product 3D Scene

**Best for:** distinctive FMCG with strong brand character (drinks, snacks, supplements), tech gadgets, toys, novelty/quirky brands willing to be bold.
**Best persona:** product-whisperer (as narrator/director), comedic-foodie energy embedded in product character.
**Best voice:** gacrux (male hype — embed as product voice), iapetus (female Gen-Z — product character alt), achird (male warm — friendly product personality).

## Setting block (paste into prompt body)
"3D-animated environment. Product (bottle, box, or device) stands anthropomorphized on a clean gradient-coloured stage — minimal background. Product has simplified face (eyes on label, arms from sides). Warm key light from above-right, rim light from behind. Pastel or brand-colour background gradient."

## Camera + framing
- Medium shot: product centred, full body visible — face and gesture arms in frame.
- Close-up on product face for dialogue beat — push-in on face.
- 9:16 vertical. 3D scene framing — virtual 35mm equivalent.
- Camera: slow push-in on hook (85% success). Orbit only if background is solid/gradient (orbit on complex BG = smear).

## Lighting
"3D scene: warm key from above-right at 45°, soft fill from left, hard rim light from behind-left creating product silhouette pop. Background gradient from brand colour (bottom) to white (top). Specular highlight on product surface — shows material quality."

## Action beats (8s)
- 0–2s: Product "wakes up" or bounces into frame. Face animates — eyes open, arms spread. Hook line spoken in product's voice.
- 2–5s: Product gestures to demonstrate function (points, pours self, spins label to camera). Self-referential humour.
- 5–7s: Product reacts to imaginary user — thumbs up, wink, or happy bounce. Testimonial line as if product is bragging.
- 7–8s: Product waves at camera, CTA spoken, settles back to static hero product shot.

## Dialog patterns (product voice — BM/EN code-switch)
**Hook (0-2s, product speaks):**
- "Eh korang, jangan scroll dulu — dengar aku kejap!"
- "Aku [PRODUCT NAME]. Aku tau korang tengah scroll... tapi aku interesting, promise."
- "Korang nak tau apa yang buat aku berbeza? Jom aku tunjuk."

**Core (2-5s, product speaks):**
- "Tengok label aku — confirm halal, ingredients clean. Aku bangga tau."
- "Aku dah help 10,000 orang — nak jadi sorang lagi ke tak?"
- "Formula aku: 3 bahan power, zero chemical pelik-pelik. Simple macam aku."

**Outro (7-8s, product speaks):**
- "Tekan beg kuning sekarang — aku tunggu kat sana!"
- "Free delivery menanti — aku nak jumpa korang!"
- "Bye! Order cepat, stock aku pun limited!"

## Audio (5-layer)
- Dialogue: ONE product voice — animated, slightly compressed/produced for cartoon feel. Not human-natural.
- SFX: "cartoon boing, whoosh on entrance, pop on label spin, happy jingle on thumbs-up, sparkle on product reveal".
- Ambience: "minimal stage ambience — faint hum of stage/studio, no real-world sounds".
- Music: playful branded jingle loop at −14dB under dialogue. Can spike to −6dB during action beats.
- Negatives: "no human voice other than product character, no real-world ambience, no generic stock music".

## Veo prompt skeleton
"3D animated medium shot, virtual 35mm, slow push-in on hook. Anthropomorphized <PRODUCT> on gradient stage — eyes on label, gestural arms. Product bounces, spreads arms, spins to show label, gives thumbs-up. Product says: '<HOOK_LINE>'. Warm key from above-right, rim from behind-left, brand-colour gradient background. SFX: cartoon boing, whoosh, sparkle. Ambience: minimal stage hum. Voice direction: <VOICE_ID>, animated/slightly processed character voice. 9:16."

## Common failure modes + fixes
- Product looks uncanny/creepy → "simplified friendly eyes (2 circles), no human mouth — use label text as speech caption".
- Arms look wrong → "simple extruded arms from bottle sides — cartoonish, not realistic human limbs".
- Background too complex → "solid gradient ONLY — complex BG causes geometry smear on orbit shots".
- Product voice sounds too human → "slight pitch-up +10%, subtle reverb, compressed — animated character feel".
- CTA breaks character → keep CTA in-character: product "walks" toward camera and points down to beg kuning.

## Persona + voice fit
- **comedic-foodie energy (in product)** + gacrux: highest entertainment value, food/snack products especially.
- **product-whisperer narrator** + achird: narrator off-screen, product pantomimes — split voice approach.
- **casual-bestie energy** + iapetus: for female-targeted products where product character is relatable peer.

## Cultural notes
- Talking product format is EMERGING in MY TikTok (2025-26) — early adopter brands get novelty boost.
- Works best for products with strong visual identity (distinctive packaging, brand colour).
- Halal products: have the product character "show off" the halal logo — self-referential halal pride works.
- Younger demographic (18-25) responds best — Gen-Z appreciates meta/absurdist brand humour.
- Ramadan: product character can wear a sampin or say "Selamat Berbuka" for seasonal variation.
`,
};
