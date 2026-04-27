import type { Skill } from "../../types";

export const sceneFoodieReaction: Skill = {
  id: "foodie-reaction",
  kind: "scene",
  tab: "ugc",
  title: "Foodie Reaction — First-Bite Exaggerated Mukbang Energy",
  triggers: ["foodie", "reaction", "first bite", "taste test", "food review", "exaggerated", "eating reaction", "food content"],
  body: `# Foodie Reaction Scene

**Best for:** F&B products, snacks, instant food, sauces, beverages, restaurant/food delivery, any edible product needing strong taste proof.
**Best persona:** comedic-foodie, casual-bestie, mak-cik-converter.
**Best voice:** gacrux (male hype), enceladus (female mom-warm), iapetus (female Gen-Z).

## Setting block (paste into prompt body)
"Bright home dining table or kitchen counter, daytime. Plate of food plated simply — not restaurant-styled, home-real. Product packaging visible as prop beside plate. Warm overhead or window light from the front-left. Table surface clean but not pristine — practical home context."

## Camera + framing
- Static medium close-up at table level — face and food both in frame simultaneously.
- Very slight low angle (10° below chin): food looks more appetising, creator looks engaged.
- Optional overhead B-roll for plating/pour shot before cutting back to reaction.
- 9:16 vertical. 50mm for face compression, 35mm for wider food + face frame.

## Lighting
"Window light from camera-left (diffused, not direct sun — cloudy day or curtain). Warm fill from overhead or small reflector card on right. Food needs warm lighting: 3200–3500K. Face must be evenly lit — no harsh chin shadow."

## Action beats (8s)
- 0–2s: Creator eyes the food/product with anticipation — exaggerated build-up pause, hook line.
- 2–4s: First bite — fork/spoon/hand to mouth. SLOW the chew for 1-beat, then reaction hits.
- 4–6s: Reaction peak: eyes wide, hand covers mouth, involuntary sound ("weh!", "eh!", "Ya Allah sedap!"), gestural overload.
- 6–8s: Recovers, faces camera directly, product picked up. Outro with real specific flavour description + CTA.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Okay korang, aku dah tahan nafas dua hari nak try [PRODUCT] ni — jom."
- "Serious tak tipu — kalau tak sedap aku taklah share kat sini."
- "Tunggu jap, muka aku memang gini bila excited makan — tengok."

**Core (4-6s, post-reaction):**
- "Weh! Rasa dia — perasa dia kuat gila tapi tak overwhelming. Aku tak expect."
- "Pedas sikit, manis ada, kuah dia pekat — confirm betul rasa macam home-cooked."
- "Texture dia pun — lembut dalam tapi ada bite kat luar. Padu gila."

**Outro (6-8s):**
- "Ni serious bukan paid promotion fake — aku genuinely suka. Tekan beg kuning."
- "Korang kena try sendiri, aku tak pandai describe betul-betul. Link in bio."
- "Order je, kalau tak sedap aku makan lagi — confident tu."

## Audio (5-layer)
- Dialogue: ONE speaker — real-time reaction, slightly breathless between bites.
- SFX: "fork on ceramic, crispy crunch, chewing sound (subtle, not gross), 'mmm' involuntary, glass set down".
- Ambience: "home midday quiet, faint kitchen background, ceiling fan low hum".
- Music: trending 2-bar hook used as stinger at reaction peak (0.5s) then duck hard.
- Negatives: "no canned laughter, no excessive slurping, no food ASMR over-amplification".

## Veo prompt skeleton
"Static medium close-up, 50mm, camera at table level, 10° low angle. <PERSONA_DESCRIPTOR> at home dining table, plate of food and <PRODUCT> packaging visible. Takes first bite — pauses — eyes widen, hand covers mouth, involuntary excited reaction. Recovers, holds up <PRODUCT>, speaks directly. He/She says: '<HOOK_LINE>'. Warm window light from left 3200K, right-side fill. SFX: fork on plate, food crunch. Ambience: home midday quiet, ceiling fan. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Reaction looks performed/fake → add "genuine surprise micro-expressions — slight furrowed brow before smile, not instant grin".
- Food looks unappetising → "food plated simply but with sauce/steam visible — not dry or cold-looking".
- Audio picks up too much chewing → "speaks then eats then speaks — not simultaneously eating and talking".
- Flavour description too vague → script specific sensory words: "pedas kat belakang tekak, manis depan — aftertaste clean".
- Product disappears after bite → ensure "creator returns to hold product label toward camera before outro".

## Persona + voice fit
- **comedic-foodie** + gacrux: maximum mukbang energy, male hype voice, highest entertainment value.
- **mak-cik-converter** + enceladus: auntie discovering amazing product — authentic disbelief is gold.
- **casual-bestie** + iapetus: Gen-Z girl reaction — relatable "omg guys" energy, broad demographic pull.

## Cultural notes
- Malaysian food reaction norms: exaggeration is expected and enjoyed — not seen as fake. Push the reaction further than feels comfortable.
- Halal confirmation: if product is meat-based, show halal logo prominently within first 5s.
- Ramadan: first-bite content = berbuka highlight peak content. Frame as "malam berbuka dengan [PRODUCT]".
- Avoid: reactions involving pork/alcohol, or props that suggest non-halal context near food.
- Tamil/Chinese audience crossover: mixed-language reactions work well — "Wah sedap!" (Malay) + "真的好吃!" (Mandarin) can be layered for multi-ethnic appeal.
`,
};
