import type { Skill } from "../../types";

export const sceneInCarDrivingCta: Skill = {
  id: "in-car-driving-cta",
  kind: "scene",
  tab: "ugc",
  title: "In-Car / Driving — Casual Talking-Head CTA",
  triggers: ["car", "driving", "in-car", "road", "parked", "commute", "steering wheel", "dashboard"],
  body: `# In-Car Driving CTA Scene

**Best for:** finance apps, insurance, food delivery, e-commerce impulse buys, lifestyle products, any product with a "I just discovered this" hook.
**Best persona:** casual-bestie, skeptic-converted, urban-hijabi-bestie.
**Best voice:** callirrhoe (female mid neutral), achird (male warm), iapetus (female Gen-Z).

## Setting block (paste into prompt body)
"Interior of a modern sedan, parked or slow-moving Malaysian urban traffic. Dashboard visible, steering wheel to the left. Afternoon overcast daylight through windscreen from the front, city bokeh visible through rear window. Creator in driver seat, phone mounted or handheld at dashboard level."

## Camera + framing
- Selfie POV dashboard-mount: phone clipped to vent/windscreen, slightly below eye level — authentic dashcam-style UGC.
- Handheld selfie stick: natural car-interior angle, slight tilt toward creator.
- 9:16 vertical. 24mm wide feel OR 35mm. Slight shake on handheld = real.

## Lighting
"Soft diffused daylight through windscreen (overcast ideal — no harsh sun stripe). Optional: warm afternoon side-window fill from driver window. No ring light — ring light in-car = uncanny. Natural fill only."

## Action beats (8s)
- 0–2s: Creator glances at camera mid-thought (parked at traffic light or stationary). Hook line — conversational, unpolished.
- 2–5s: Picks up or shows product, explains discovery story. Natural pause, gesture toward camera.
- 5–7s: Reaction beat — "Serious ni, aku dah order 3 kali." Product held up briefly.
- 7–8s: Eyes back on camera, CTA, smile. "Tekan beg kuning, korang."

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Eh jap, aku nak bagitau korang something — dalam kereta ni kan..."
- "Okay korang, tengah tunggu traffic ni aku nak share satu benda gila useful."
- "Bro, tadi aku order barang ni sambil tunggu Grab — confirm terbaik."

**Core (2-5s):**
- "So basically aku jumpa [PRODUCT] masa scroll TikTok — memang dalam wishlist lama dah."
- "Price dia pun okay gila, free delivery — aku langsung checkout, tak pikir panjang."
- "Quality dia syok, serious — my friend pun dah tanya aku beli mana."

**Outro (7-8s):**
- "Tekan beg kuning, korang — jangan tanya harga dulu, tengok dulu."
- "Link in bio, aku dah letak — cepat sikit, flash sale sampai malam ni je."
- "Order sekarang, esok pagi dah sampai — aku janji."

## Audio (5-layer)
- Dialogue: ONE speaker, relaxed conversational pace — like voice note to a friend.
- SFX: "seatbelt click, soft AC vent hum, distant car horn outside, phone notification ping".
- Ambience: "city traffic murmur, occasional rain on windscreen, radio static bleed (very low)".
- Music: none or ultra-low lofi, fully ducked under dialogue.
- Negatives: "no car engine revving, no loud music, no road-rage sounds".

## Veo prompt skeleton
"Selfie POV, dashboard-mount angle, 35mm, slight camera shake. <PERSONA_DESCRIPTOR> seated in a modern sedan parked in Malaysian urban traffic, soft diffused daylight from windscreen. Holds <PRODUCT> up toward camera, gestures naturally. He/She says: '<HOOK_LINE>'. Ambience: city traffic murmur, AC vent hum. SFX: seatbelt click, soft horn in distance. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Ring light halo appears in window → replace with "soft diffused overcast daylight, NO artificial ring light".
- Driving looks reckless → specify "parked at roadside or stationary in slow traffic" explicitly.
- Creator looks stiff/posed → add "casual seated posture, slight lean toward dashboard, unscripted feel".
- Background too empty → add "city skyline or KL traffic bokeh visible through rear windscreen".
- Wrong country vibe → add "right-hand drive, Malaysian road markings, Bahasa road signs" if needed.

## Persona + voice fit
- **casual-bestie** + callirrhoe: most natural car-talk vibe, gender-neutral appeal.
- **urban-hijabi-bestie** + achernar: high-trust for female Muslim audience, hijab frame works perfectly in car context.
- **skeptic-converted** + achird: "I didn't believe the hype until I ordered it" — strong conversion angle.

## Cultural notes
- In-car format = extremely high authenticity signal for Malaysian audience — feels unfiltered, on-the-go.
- Parked car preferred over moving — avoid showing creator distracted while driving (brand risk).
- Grab/e-hailing context is relatable: "tunggu Grab order" or "baru habis hantar anak" framing works well.
- Hijabi creator in car: headscarf + casual outfit is the most common and trusted UGC aesthetic in MY.
`,
};
