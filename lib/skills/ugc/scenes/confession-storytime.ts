import type { Skill } from "../../types";

export const sceneConfessionStorytime: Skill = {
  id: "confession-storytime",
  kind: "scene",
  tab: "ugc",
  title: "Confession / Storytime — Bedroom Vulnerability",
  triggers: ["confession", "storytime", "bedroom", "vulnerability", "honest", "personal", "story", "real talk", "open up"],
  body: `# Confession Storytime Scene

**Best for:** skincare (acne/dark spots journey), weight management, mental wellness, hair care, relationship/self-improvement products, anything with an emotional before-story.
**Best persona:** confessional-intimate, skeptic-converted, inspirational-soft.
**Best voice:** achernar (female soft), callirrhoe (female mid neutral), charon (male deep auth).

## Setting block (paste into prompt body)
"Bedroom at late morning or early evening. Sitting on bed or leaning against headboard. Soft natural window light from camera-right, thin curtain diffusing harsh sun. Pillows, fairy lights or bedside lamp visible. Minimal, lived-in feel — not staged. Creator in casual home outfit, no full makeup (vulnerability aesthetic)."

## Camera + framing
- Selfie POV handheld or propped on pillow/small stand — deliberately imperfect angle, intimate.
- Medium close-up shows face + upper chest. Slight downward tilt of phone (looking into camera from above = approachable).
- 9:16 vertical. 35mm. Natural wobble = authentic. Smooth = too polished for this format.

## Lighting
"Soft window diffuse from right (thin white curtain). Optional: warm bedside lamp for golden fill. Target: flattering but real — slight under-eye shadow okay, skin texture visible. No ring light. No softbox."

## Action beats (8s)
- 0–2s: Creator looks directly at camera, quiet pause, then honest hook — confessional opener, no fanfare.
- 2–5s: Shares the "before" struggle story — voice slightly lower, personal. Product introduced as the turning point.
- 5–7s: Shows product, describes the change/result. Sincere, not loud. Gesture toward product label.
- 7–8s: Soft, direct close — grateful tone. CTA as an invitation, not a push.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Okay aku nak cerita something yang aku tak pernah share kat sini..."
- "Korang, jujur je — dulu aku betul-betul tak confident dengan kulit aku."
- "Eh, benda ni aku rasa awkward nak cakap, tapi korang kena tahu."

**Core (2-5s):**
- "Aku dah try banyak benda — seriously habis duit, tak juga jalan. Sampai aku jumpa [PRODUCT]."
- "3 minggu lepas aku start pakai, tak expect pun. Tapi minggu ke-2, orang mula tegur."
- "Aku tak tipu — progress dia slow tapi real. Bukan magic, tapi memang works."

**Outro (7-8s):**
- "Kalau korang struggle macam aku dulu, cuba je dulu. Tekan beg kuning."
- "Link in bio — halal, no harsh chemicals. Aku dah extend sampai bulan depan."
- "Aku share sebab aku nak korang rasa confident macam aku sekarang."

## Audio (5-layer)
- Dialogue: ONE speaker, quiet and warm — bedroom voice, not broadcast voice.
- SFX: "soft bedsheet rustle, product lid click, gentle serum pump, curtain shift in breeze".
- Ambience: "light birdsong outside window, distant traffic hum, room tone quiet — almost silent".
- Music: soft piano or acoustic guitar, −22dB, ghost level under dialogue.
- Negatives: "no loud SFX, no crowd, no dramatic music swell, no phone notification sounds".

## Veo prompt skeleton
"Selfie POV, phone propped at medium close-up, 35mm, slight natural wobble. <PERSONA_DESCRIPTOR> seated on bed against pillows in a simple Malaysian bedroom, casual home outfit, minimal makeup. Holds <PRODUCT>, speaks directly and sincerely to camera. He/She says: '<HOOK_LINE>'. Soft diffused window light from right, warm bedside lamp fill. SFX: bedsheet rustle, serum pump. Ambience: distant birdsong, quiet room tone. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Creator looks too polished → add "no heavy makeup, natural skin, casual T-shirt or baju kurung at home".
- Bedroom looks staged/empty → add "lived-in details — throw pillow, phone charger, book on bedside table".
- Emotional beat falls flat → script the pause: "two-beat silence before speaking — let tension breathe".
- Product pitch feels sudden → bridge it: "dah 3 minggu aku cuba, and then aku nak share apa jadi..."
- Lighting too dark → "soft bedside lamp warm 2700K fill from right, not dim — warm but clear".

## Persona + voice fit
- **confessional-intimate** + achernar: core format — soft female storyteller, maximum trust-build.
- **skeptic-converted** + callirrhoe: "I was skeptical, here's my honest review" — high-conversion angle.
- **inspirational-soft** + charon: male vulnerability — rarer but powerful for male wellness/skincare.

## Cultural notes
- Vulnerability content drives highest save rates in MY — audience saves to revisit the journey.
- Hijabi creators: in-bedroom content is normal for Malaysian TikTok — headscarf may or may not be worn at home (creator's choice). Respect both presentations.
- Acne/dark spot journeys: huge for Malaysian skin tone context — Morena/Sawo matang skin tone representation is underserved and high-converting.
- Avoid: crying performance that seems acted — Malaysian audience detects fake vulnerability quickly. "Real awkward" beats "performed emotional".
`,
};
