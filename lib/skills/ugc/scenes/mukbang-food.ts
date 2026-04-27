import type { Skill } from "../../types";

export const sceneMukbangFood: Skill = {
  id: "mukbang-food",
  kind: "scene",
  tab: "ugc",
  title: "Mukbang / Mamak Eating — Exaggerated Taste Reaction",
  triggers: ["mukbang", "food", "eating", "mamak", "reaction", "taste", "sedap", "khairul aming", "makan"],
  body: `# Mukbang Food Scene

**Best for:** F&B products, sauces, instant noodles, snacks, halal ready-meals, beverages, condiments, any food product.
**Best persona:** comedic-foodie, casual-bestie, mak-cik-converter.
**Best voice:** gacrux (male hype), enceladus (female mom-warm), callirrhoe (female mid neutral).

## Setting block (paste into prompt body)
"Malaysian mamak restaurant booth or home dining table, late evening. Stainless-steel tray with roti canai or nasi visible, Milo tin and sambal cup as table props. Warm tungsten pendant light from above, slight steam from food. Lively background — other diners visible but blurred."

## Camera + framing
- Static medium close-up on tripod/stand at table level — food and creator face both in frame.
- Slight upward angle (camera below chin) — Khairul Aming signature framing.
- 9:16 vertical. 50mm natural feel. Food close-up B-roll at overhead or macro.

## Lighting
"Warm tungsten pendant overhead, slight warm fill from phone or small LED panel camera-right. Food must look appetising — warm colour temperature 3200K. Natural steam visible if hot food."

## Action beats (8s)
- 0–2s: Creator stares at food dramatically, picks up product/food, delivers hook directly to camera — exaggerated anticipation.
- 2–5s: Takes first bite / sip. Exaggerated chewing, eyes wide, hand gestures — the "tahan nafas" moment.
- 5–7s: Full reaction — eyes roll, hand on chest, chef-kiss or fist on table. Verbalises reaction.
- 7–8s: Product label to camera. Outro with CTA. Big smile.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Korang, aku nak nangis — kenapa aku baru jumpa [PRODUCT] sekarang?!"
- "Eh serious ke tak serious — mamak pun kalah, bro."
- "Jangan tengok video ni kalau korang tengah lapar — aku warned dah."

**Core (2-5s):**
- "Confirm sedap gila babs — rasa dia tu... eh aku tak boleh explain, korang kena try sendiri."
- "Weh perasa dia tu padu, aku dah habis satu bungkus — malu tapi betul."
- "Kuah dia pekat, manis-manis pedas sikit — memang masuk dengan nasi panas."

**Outro (7-8s):**
- "Tekan beg kuning sekarang — stock aku pun dah nak habis ni."
- "Order la, free delivery — aku order lagi dah ni."
- "Halal tau, korang boleh makan dengan tenang."

## Audio (5-layer)
- Dialogue: ONE speaker, enthusiastic but clear — not muffled by food.
- SFX: "crispy food crunch, slurp, fork on plate, ice rattling in glass, plastic packaging tear".
- Ambience: "mamak chatter, ceiling fan hum, distant kitchen clatter, motorbike outside".
- Music: none during reaction; optional 2-bar trending hook under outro only.
- Negatives: "no canned laughter, no studio quiet, no background music drowning dialogue".

## Veo prompt skeleton
"Static medium close-up, 50mm, camera at table level. <PERSONA_DESCRIPTOR> seated at a Malaysian mamak restaurant, stainless tray of food in front, holds <PRODUCT>. Takes exaggerated first bite — eyes widen, hand on chest, chef-kiss gesture. He/She says: '<HOOK_LINE>'. Warm tungsten pendant overhead, 3200K colour tone. SFX: food crunch, fork on plate. Ambience: mamak chatter, ceiling fan. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Food looks unappetising/cold → add "warm tungsten light, visible steam, glistening sauce".
- Reaction looks faked/over-acted → add "genuine surprise expression — eyebrows raised, slight lean back".
- Muffled dialogue while eating → specify "reacts then speaks clearly, not mid-chew".
- Wrong food context → specify exact food: "roti canai, nasi lemak, mee goreng" to anchor scene.
- Halal context unclear → include "no pork/alcohol props on table, Milo or teh tarik as drink".

## Persona + voice fit
- **comedic-foodie** + gacrux: highest energy mukbang energy, Khairul Aming style exaggeration.
- **casual-bestie** + callirrhoe: relatable everyday eating, slightly softer reaction.
- **mak-cik-converter** + enceladus: auntie discovering new product — nostalgic + trust-building.

## Cultural notes
- Ramadan: pivot from eating video to "berbuka highlight" or "sahur prep" — daylight mukbang during Ramadan is insensitive.
- Halal context: visually confirm no beer/wine glasses, no pork-adjacent props. Milo, teh tarik, air sirap = safe signals.
- Mamak setting = universal Malaysian comfort — crosses race/religion boundaries. Most inclusive food setting available.
- Khairul Aming formula: exaggerated reaction → specific flavour description → emotional payoff → buy now. Follow this arc.
`,
};
