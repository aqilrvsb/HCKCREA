import type { Skill } from "../../types";

export const sceneVintageVhsUnbox: Skill = {
  id: "vintage-vhs-unbox",
  kind: "scene",
  tab: "ugc",
  title: "Vintage VHS Unboxing — Top-Down Hands, 90s Home Video Aesthetic",
  triggers: ["vhs", "vintage", "retro", "90s", "grain", "home video", "nostalgic", "old school", "film grain", "unboxing aesthetic"],
  body: `# Vintage VHS Unboxing Scene

**Best for:** retro-positioned products, heritage brands, fashion/streetwear, music/entertainment, food with nostalgic angle, any product that benefits from "nostalgia + discovery" tension.
**Best persona:** casual-bestie, urban-hijabi-bestie (for fashion), chinese-malaysian-codeswitcher (for multi-ethnic retro appeal).
**Best voice:** achird (male warm gravelly), callirrhoe (female mid neutral), algenib (male gravelly — most VHS-era feel).

## Setting block (paste into prompt body)
"Top-down overhead shot of hands on a textured surface — wooden table or vintage fabric. VHS-style film grain overlay, scan lines, colour bleed at edges, slight 4:3 letterbox then crop to 9:16. Warm tungsten 2800K practical lamp from camera-right. Props: cassette tape case, polaroid, retro packaging. Palette desaturated warm (amber-green bias)."

## Camera + framing
- Overhead top-down LOCKED on tripod — classic 90s home video unboxing angle.
- Hands-only frame: no face, creator identity is hands and voice only.
- Optional: occasional glance-up to a separate mirror/reflection shot for face reveal.
- 9:16 vertical (simulate by cropping 4:3 after + scan line overlay). 35mm equivalent.

## Lighting
"Single warm tungsten practical lamp from camera-right (2800K, slight orange push). No fill — hard single-source shadows are part of aesthetic. Slight underexposure intentional — lifted in 'analogue' grade. Avoid LED colour cast unless deliberately colour-shifted."

## Action beats (8s)
- 0–2s: Hands pick up product package — hold it toward camera. Slight wobbly zoom (simulated). VHS timestamp graphic lower-left.
- 2–5s: Slow unboxing — peel sticker, open flap, slide product out. Each layer a reveal. No rush — savouring pace.
- 5–7s: Product in hands — rotate slowly, inspect each side. "Surprised" hand gesture. Optional face-reveal cameo.
- 7–8s: Product placed down on surface. Hand taps twice (approval signal). VHS "STOP" graphic flicker. CTA title card.

## Dialog patterns (Malay/EN code-switch, spoken over VHS aesthetic)
**Hook (0-2s):**
- "Korang, aku record ni tahun 1996... (wink) — okay tipu, tapi check ni out."
- "Throwback vibes tapi produk dia 2025 — tengok."
- "Bila last korang dapat parcel rasa macam Christmas pagi?"

**Core (2-5s):**
- "Packaging dia pun dah tahu quality — serius, macam bukak hadiah."
- "Dari dalam sampai luar, detail dia thoughtful gila — aku respect."
- "Korang, kalau beli online, first impression tu penting — [PRODUCT] memang deliver."

**Outro (7-8s):**
- "Tekan beg kuning — packaging cantik, product lagi cantik."
- "Link in bio. Kalau tak order sekarang, korang rugi aesthetic."
- "Bayar sekarang, enjoy bila sampai — trust the process."

## Audio (5-layer)
- Dialogue: ONE speaker — warm, slightly low-fi processed (mild tape saturation feel). Not clean studio.
- SFX: "cardboard tear, tape peel, paper crinkle, plastic wrap crunch, product tap on wood — all slightly lo-fi processed".
- Ambience: "VHS tape hiss (constant, low), static crackle at cuts, faint distant TV chatter (period-accurate)".
- Music: cassette-era RnB or Malaysian 90s pop melody (very low, −20dB). Pause music on voice.
- Negatives: "no modern clean digital audio, no bass-heavy trap beat, no crystal-clear stereo field".

## Veo prompt skeleton
"Overhead top-down locked camera, 35mm. Hands on wooden table with warm tungsten lamp from right. Picks up <PRODUCT> package. Slow deliberate unboxing — peel, open, slide. Rotates product in hands. Taps product twice on table. VHS film grain overlay, scan lines, 2800K warm push, slight desaturate. Voice-over: '<HOOK_LINE>' with mild tape saturation processing. SFX: cardboard tear, paper crinkle, VHS hiss ambient. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Grain too heavy → specify "subtle VHS grain — texture not noise. Grain size: medium, opacity 35%".
- Hands look too modern/manicured → "natural hands — no nail art (or retro nail art), slight texture, real skin".
- Pacing too fast for aesthetic → "deliberate slow hands — 2-3 seconds per packaging layer, savouring pace".
- Audio too clean → "apply mild tape saturation to all audio channels — 1kHz boost, slight high-cut above 12kHz".
- CTA feels out of place → integrate CTA into VHS graphic: "Title card in VHS font: TEKAN BAG KUNING ↓".

## Persona + voice fit
- **casual-bestie** + algenib: gravelly warmth + vintage aesthetic = nostalgic authority.
- **chinese-malaysian-codeswitcher** + achird: 90s Malaysian multicultural nostalgia — "dulu-dulu punya vibe".
- **urban-hijabi-bestie** + callirrhoe: retro fashion unboxing — modest streetwear with VHS filter = trendy contrast.

## Cultural notes
- 90s Malaysian nostalgia = strong emotional hook across all ethnic groups — RTM, TV2, kaset pita era.
- VHS aesthetic signals "real" and "unfiltered" to younger Gen-Z audience who never experienced VHS — ironic authenticity.
- Avoid: anything in VHS context that could be misread as piracy or counterfeit product signalling.
- Hari Merdeka: VHS aesthetic + Merdeka soundtrack references = high-shareability August content.
`,
};
