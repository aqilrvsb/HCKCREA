import type { Skill } from "../../types";

export const sceneGymSupplement: Skill = {
  id: "gym-supplement",
  kind: "scene",
  tab: "ugc",
  title: "Gym / Post-Workout — Supplement Reveal",
  triggers: ["gym", "supplement", "protein", "fitness", "workout", "post-workout", "creatine", "whey"],
  body: `# Gym Supplement Scene

**Best for:** protein powder, pre/post-workout drinks, creatine, BCAAs, energy drinks, sports nutrition, fitness apparel.
**Best persona:** gym-bro, casual-bestie (female fitness), skeptic-converted.
**Best voice:** gacrux (male hype), achird (male warm), iapetus (female Gen-Z).

## Setting block (paste into prompt body)
"Busy commercial gym floor, late afternoon. Weight racks and mirrors visible in background, slightly out of focus. Rubber floor tiles, overhead industrial LED banks casting cool top-light. Creator is visibly sweaty — damp hairline, flushed cheeks, gym towel draped over one shoulder."

## Camera + framing
- Selfie POV chest-up (creator holds phone/selfie stick, slightly below chin level) — triggers authentic UGC cam feel.
- Static medium close-up on a flat bench or mirror ledge for shake/bottle B-roll.
- 9:16 vertical. 35mm natural lens. Slight camera shake = intentional authenticity.

## Lighting
"Cool overhead LED bank from above, warm mirror-edge fill from camera-right. Slight hard shadow under chin — real gym look, no softbox. Sweat sheen on skin visible."

## Action beats (8s)
- 0–2s: Creator catches breath, looks at camera mid-post-workout, holds supplement bottle up — hook line delivered.
- 2–5s: Shakes or scoops product, pours into shaker or water bottle. Close-up of powder/liquid mixing — texture moment.
- 5–7s: First sip. Eyes close, slight head nod, thumbs up or fist pump.
- 7–8s: Label faces camera. Outro line. Cut.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Eh korang, lepas workout confirm lapar gila — aku pakai [PRODUCT] je."
- "Bro, protein shake aku dah lain lepas try ni, confirm padu."
- "Workout habis, tapi energy aku? Masih penuh — sebab [PRODUCT]."

**Core (2-5s):**
- "Rasa dia tak bitter, sedap gila babs — mixed dengan air sejuk lagi best."
- "Aku dah 3 bulan pakai, muscle recover lagi cepat, no cap."
- "Halal certified, ingredients clean — confirm boleh trust."

**Outro (7-8s):**
- "Tekan beg kuning, free shipping hari ni je."
- "Link in bio, jangan miss — stock terhad."
- "Try dulu, kalau tak suka aku belanja kopi."

## Audio (5-layer)
- Dialogue: ONE speaker only, slightly breathless delivery for authenticity.
- SFX: "shaker bottle rattling, powder hitting plastic, gym weight clank in background, velcro gym glove rip".
- Ambience: "distant treadmill hum, low gym background chatter, faint bass from gym speakers".
- Music: optional trending gym hype track, ducked low under dialogue (−18dB).
- Negatives: "no dramatic orchestral music, no studio silence, no crowd cheering".

## Veo prompt skeleton
"Selfie POV medium close-up, 35mm, slight camera shake. <PERSONA_DESCRIPTOR> in a busy commercial gym, post-workout — sweaty, flushed, gym towel on shoulder. Holds <PRODUCT> and shakes it into a bottle. Takes a sip, nods approval, fist pump. He/She says: '<HOOK_LINE>'. Cool overhead LED lighting, warm mirror fill from right. SFX: shaker rattle, distant weight clank. Ambience: treadmill hum, low gym chatter. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Creator looks too clean/dry → add "visibly sweaty — damp hairline, flushed skin, minor shine on forehead".
- Gym looks fake/empty → add "busy gym floor with other athletes visible but blurred in background".
- Product color looks off → specify exact liquid color: "opaque white shake" or "neon green drink".
- Audio too silent/studio-clean → add "ambient gym noise — distant weights, low chatter".
- Wrong gender vibe → specify "male creator" or "female fitness creator" explicitly in persona block.

## Persona + voice fit
- **gym-bro** + gacrux: highest energy, bro-code dialect, "bro confirm power".
- **skeptic-converted** + achird: "I used to think supplements were overrated, until..." — high conversion trust.
- **casual-bestie (female)** + iapetus: Gen-Z female fitness creator, softer hype, wider audience.

## Cultural notes
- Halal certification is critical — Muslim gym-goers check ingredients rigorously. Show halal logo or text "Halal Certified" in first 5s.
- Avoid alcohol-fermented ingredients implied in script — e.g. say "fermentation-free" if relevant.
- Ramadan: pivot to "sahur fuel" (pre-dawn) or "buka puasa recovery" framing — avoid daylight consumption shots.
- Malay gym culture: "gain badan" goal resonates more than pure aesthetics for male demo; "sihat + kurus" for female demo.
`,
};
