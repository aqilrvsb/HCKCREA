import type { Skill } from "../../types";

export const sceneStopMotionClay: Skill = {
  id: "stop-motion-clay",
  kind: "scene",
  tab: "ugc",
  title: "Stop-Motion Clay — Wallace & Gromit Product Transform",
  triggers: ["stop motion", "clay", "claymation", "animated", "3d", "wallace gromit", "stylized", "product animation", "transform"],
  body: `# Stop-Motion Clay Scene

**Best for:** quirky FMCG products, snacks, toys, children's products, novelty lifestyle items, tech accessories, any brand willing to be playful and distinctive.
**Best persona:** product-whisperer, educational-expert (as narrator voice off-screen).
**Best voice:** gacrux (male hype narrator), achird (male warm), callirrhoe (female mid neutral).

## Setting block (paste into prompt body)
"Miniature clay-world set on a wooden workshop table. Walls are clay-textured pale blue. Small clay tools and clay-extruded props in background. The product (or a clay replica of it) sits centre-frame on a clay pedestal. Warm practical overhead lamp from above-right, casting soft shadow. Fingerprint textures visible on clay surfaces — handmade aesthetic."

## Camera + framing
- Overhead top-down locked off on tripod — standard stop-motion rig angle for product transformation sequences.
- Low front angle (5cm above table surface) for hero reveal — dramatic clay product entrance.
- 9:16 vertical. 50mm macro feel. Camera must be LOCKED — no shake, no drift.

## Lighting
"Warm practical overhead desk lamp from above-right, single dominant source (3200K). Soft fill reflector card on camera-left. Hard-edged shadows acceptable — adds handcrafted authenticity. No coloured gels unless product colour demands it."

## Action beats (8s)
- 0–2s: Clay hands enter frame, assemble product from clay blobs — fast-motion transform. Hook title card or voice-over hook.
- 2–5s: Clay product animates — walks, waves, bounces, or demonstrates function in miniature clay-world context.
- 5–7s: Real product slides in next to clay version — contrast moment. Clay hand points to real product.
- 7–8s: Clay character gives thumbs-up or does happy jiggle. Voice-over CTA or title card.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s, typically voice-over or title card):**
- "Apa yang [PRODUCT] buat untuk korang? Jap, biar clay explain..."
- "Okay kami buat demo — versi clay dulu, pastu yang real."
- "Satu video, satu produk, tapi macam cerita kartun — jom!"

**Core (2-5s, voice-over):**
- "Tengok macam mana [PRODUCT] kerjanya — simple, effective, tak payah fikir banyak."
- "Clay version pun dah nampak berkesan — bayangkan yang real punya."
- "Dari bahan sampai hasil — semuanya kat sini."

**Outro (7-8s, voice-over or title card):**
- "Tekan beg kuning — yang real lagi best dari clay version ni."
- "Order sekarang, free delivery — no assembly required (unlike this set)."
- "Link in bio. Korang get the idea."

## Audio (5-layer)
- Dialogue: ONE voice-over narrator (off-screen), warm and slightly playful. No on-screen speaker.
- SFX: "clay squish, pop, boing, miniature footsteps, spring sound on reveal, tiny wooden surface tap".
- Ambience: "workshop quiet — ticking clock, distant street, occasional tool noise (very low)".
- Music: whimsical ukulele or toy piano loop, ducked under voice-over (−14dB during narration, −6dB during action).
- Negatives: "no realistic room tone, no human chatter, no ambient traffic — this is a miniature world".

## Veo prompt skeleton
"Overhead top-down locked camera, 50mm macro. Clay miniature world set on a wooden workshop table. Clay hands assemble <PRODUCT> from clay blobs — fast transform. Completed clay <PRODUCT> animates — bounces, waves. Real <PRODUCT> slides in next to clay version, clay hand points. Warm desk lamp overhead from right, soft fill from left. SFX: clay squish, boing, pop. Ambience: quiet workshop, ticking clock. Voice-over narration: '<HOOK_LINE>'. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Clay looks digital/plastic → add "fingerprint impressions visible on clay surfaces, imperfect handmade texture".
- Camera drift ruins stop-motion → specify "camera LOCKED on tripod — zero movement between frames".
- Product looks oversized/unscaled → specify product dimensions relative to clay set: "real product is 3x height of clay figure".
- Pacing too slow → beat math: one "frame" every 0.1s playback = 80 frames for 8s clip.
- Voice-over sounds generic → give exact script with Malay slang in voice-over: script it in the prompt.

## Persona + voice fit
- **product-whisperer** + gacrux: confident narrator who makes product feel magical — highest brand recall.
- **educational-expert** + achird: explainer tone, works for tech/functional products.
- **comedic-foodie** + gacrux: for food/snack products — playful clay food fight energy.

## Cultural notes
- Stop-motion clay = novelty in Malaysian TikTok UGC — high scroll-stop rate due to format rarity.
- Works best for 11.11/12.12 campaigns as a brand-creative hero video alongside standard UGC.
- No halal-specific concerns — purely animated format, no food/human body depiction issues.
- Malay audience responds well to cartoon/childhood nostalgia references — subtle Upin & Ipin or Doraemon prop easter eggs increase shareability.
`,
};
