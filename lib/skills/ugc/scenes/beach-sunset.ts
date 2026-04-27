import type { Skill } from "../../types";

export const sceneBeachSunset: Skill = {
  id: "beach-sunset",
  kind: "scene",
  tab: "ugc",
  title: "Beach Sunset — Wong Kar-Wai Golden Hour Product Reveal",
  triggers: ["beach", "sunset", "golden hour", "ocean", "sea", "wave", "cinematic", "wong kar wai", "outdoor"],
  body: `# Beach Sunset Scene

**Best for:** premium skincare, travel accessories, fashion, jewellery, wellness drinks, perfume/fragrance, any product that benefits from aspirational outdoor cinematic feel.
**Best persona:** inspirational-soft, urban-hijabi-bestie, polished-pro.
**Best voice:** achernar (female soft), callirrhoe (female mid neutral), charon (male deep auth).

## Setting block (paste into prompt body)
"Malaysian beach at golden hour — Port Dickson, Langkawi, or Terengganu coastline. Fine sand, warm amber horizon, shallow wave wash in foreground. Creator stands or sits near the waterline. Sun low at 15° above horizon from camera-right, casting long warm shadow. Slight sea haze, no harsh midday sun."

## Camera + framing
- Medium shot handheld: creator facing camera with sea behind — sun flare from right.
- Low angle (camera at hip level looking up): creator holds product high, horizon behind — heroic product frame.
- Selfie POV back-facing camera: secondary shot — creator films themselves with ocean in background.
- 9:16 vertical. 35mm for natural, 50mm for compressed bokeh background. Slow drift push-in acceptable (85% success rate).

## Lighting
"Golden hour backlight from camera-right (2700K, 15° above horizon). Reflective sea surface adds natural fill from below. No artificial light — pure golden hour is the asset. Shoot 20-minute window before sunset only. Lens flare: intentional, do not remove."

## Action beats (8s)
- 0–2s: Wide shot — creator walking toward camera along waterline. Product held at side. Hook voice-over or spoken.
- 2–5s: Medium close-up: creator stops, turns to camera, lifts product — reveals it with intention. Sea wind moves hair/fabric.
- 5–7s: Uses product (applies, drinks, holds up to sky). Eyes close briefly, peaceful expression.
- 7–8s: Smiles at camera, product in hand, sun behind. CTA delivered softly.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Korang, ada tak moment yang korang rasa... hidup okay?"
- "Golden hour ni memang special — macam [PRODUCT] dalam routine aku."
- "Kat mana pun korang pergi, bawa je [PRODUCT] — macam aku kat sini."

**Core (2-5s):**
- "Aku pakai [PRODUCT] ni sebelum keluar — UV protection dia memang reliable, even beach."
- "Texture dia lightweight, tak rasa berat — padan dengan cuaca Malaysia yang panas."
- "Rasa dia fresh, lepas apply terus rasa nak pergi lagi banyak tempat."

**Outro (7-8s):**
- "Tekan beg kuning — free delivery, halal certified."
- "Link in bio. Korang deserve this golden hour lifestyle."
- "Order hari ni, ready for your next beach trip."

## Audio (5-layer)
- Dialogue: ONE speaker, soft and dreamy — not projected, intimate.
- SFX: "ocean wave wash, gentle sea breeze, soft sand footstep, product cap pop".
- Ambience: "continuous ocean wave rhythm, distant seabird call, light wind across mic".
- Music: cinematic acoustic or soft synth (Wong Kar-Wai adjacent), ducked −16dB under dialogue.
- Negatives: "no boat engine, no crowd beach noise, no harsh wind distortion on mic".

## Veo prompt skeleton
"Medium shot handheld, 35mm, slight slow push-in. <PERSONA_DESCRIPTOR> walking along sandy Malaysian beach at golden hour, sea behind, waves at feet. Stops, turns to camera, lifts <PRODUCT> toward horizon. Applies/holds product, peaceful expression, eyes close briefly. He/She says: '<HOOK_LINE>'. Golden hour backlight from right 2700K, natural sea fill from below, intentional lens flare. SFX: ocean wave wash, sea breeze. Ambience: continuous wave rhythm, distant seabird. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Golden hour looks midday → specify exact sun angle: "sun 15° above horizon from right, warm amber-orange tone".
- Sea looks grey/cold → add "tropical blue-green water, warm sand, clear horizon — Malaysian coastline aesthetic".
- Creator looks windswept/messy → add "light breeze only — fabric moves gently, not violently".
- Product looks washed out in bright backlight → "product in shadow-side hand, creator slightly rotated so product catches fill light".
- CTA feels out of place in cinematic context → soften CTA: "whisper-style, relaxed delivery — not a sales shout".

## Persona + voice fit
- **inspirational-soft** + achernar: peak aspirational — dreamy voice matches golden hour visual.
- **urban-hijabi-bestie** + callirrhoe: beach hijab fashion content = one of highest-saved MY content categories.
- **polished-pro** + charon: male beach skincare/fragrance — premium, authoritative, cinematic.

## Cultural notes
- Malaysian beach content: Langkawi and Redang = aspirational tier; Port Dickson = relatable weekend tier. Choose based on brand positioning.
- Hijabi beach: swimwear/burkini creators are growing MY niche — normalised on TikTok MY, drives huge saves.
- Ramadan: beach sunset = berbuka timing — "tunggu azan sambil tengok sunset" is emotionally powerful seasonal angle.
- Sun protection products: highest-intent beach context — UV claims must be accurate (Kementerian Kesihatan compliance).
`,
};
