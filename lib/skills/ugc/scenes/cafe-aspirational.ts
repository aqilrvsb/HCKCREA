import type { Skill } from "../../types";

export const sceneCafeAspirational: Skill = {
  id: "cafe-aspirational",
  kind: "scene",
  tab: "ugc",
  title: "Indie Cafe — KL/Penang Aspirational Lifestyle",
  triggers: ["cafe", "coffee", "lifestyle", "aesthetic", "golden hour", "KL", "Penang", "indie", "aspirational", "brunch"],
  body: `# Cafe Aspirational Scene

**Best for:** premium lifestyle products, skincare, jewellery, fashion accessories, beverages, supplements with aspirational positioning, any product that benefits from "soft life" aesthetic.
**Best persona:** urban-hijabi-bestie, polished-pro, inspirational-soft.
**Best voice:** achernar (female soft), callirrhoe (female mid neutral), achird (male warm).

## Setting block (paste into prompt body)
"Trendy KL or Penang indie cafe, golden hour late afternoon. Exposed brick or whitewashed wall, rattan chair, marble-top table. Latte art in ceramic cup as prop, potted monstera or dried pampas grass in background. Warm golden window sunlight from camera-left, soft lens flare. Pastel and earth-tone palette."

## Camera + framing
- Static medium close-up on tripod at table level, slightly below eye level — flattering and composed.
- Selfie POV for more personal talking-head feel — phone handheld on small table tripod.
- Wide establishing shot (optional B-roll): 16mm wide showing full cafe aesthetic.
- 9:16 vertical. 50mm for portrait warmth, 35mm for wider lifestyle frame.

## Lighting
"Golden hour window light from camera-left (3000K warm). Optional: small warm LED panel fill on shadow side. Avoid overhead fluorescent — turn off if present. Aim for 70/30 window to fill ratio. Lens flare occasional = cinematic authenticity marker."

## Action beats (8s)
- 0–2s: Creator glances from coffee cup to camera, serene + confident. Soft hook — aspirational tone, not shouting.
- 2–5s: Picks up product naturally, holds alongside coffee cup or places on table. Speaks about discovery or routine.
- 5–7s: Uses product (applies, drinks, tries on) with soft smile. No exaggeration — understated approval.
- 7–8s: Returns to relaxed pose, product visible. Gentle outro, CTA.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Korang, ada tak benda yang buat korang rasa... upgrade sikit kehidupan tu?"
- "Jujur je — aku suka benda simple tapi quality. [PRODUCT] ni confirm masuk list."
- "Tengah lepak cafe ni, teringat nak share something yang aku dah lama guna."

**Core (2-5s):**
- "Rasa dia premium, tapi harga dia tak burn wallet — memang berbaloi."
- "Texture dia smooth, packaging pun cantik — worthy jadi part of my routine."
- "Aku pakai setiap pagi, friends semua tanya aku guna apa — ini la jawapannya."

**Outro (7-8s):**
- "Tekan beg kuning — free gift kalau order hari ni."
- "Link in bio, limited stock — trust me on this one."
- "Kalau korang nak rasa sikit lifestyle upgrade, ni start point dia."

## Audio (5-layer)
- Dialogue: ONE speaker, soft and measured — ASMR-adjacent warmth, not loud.
- SFX: "ceramic cup on saucer, gentle ice in glass, straw stir, ambient spoon clink".
- Ambience: "cafe jazz or bossa nova (very low), espresso machine steam hiss, soft cafe chatter".
- Music: gentle acoustic or lo-fi jazz, fully ducked −18dB under dialogue.
- Negatives: "no loud music, no shouting, no harsh fluorescent hum, no TikTok trending hype music".

## Veo prompt skeleton
"Static medium close-up, 50mm, tripod at table level. <PERSONA_DESCRIPTOR> seated at marble-top table in trendy KL indie cafe, latte art cup visible as prop. Holds <PRODUCT> gently, places on table with intention. Soft smile toward camera. He/She says: '<HOOK_LINE>'. Golden hour window light from left, warm lens flare. SFX: ceramic cup set down, ambient spoon clink. Ambience: low cafe jazz, espresso machine hiss. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Cafe looks generic/Starbucks → specify "independent cafe, NOT chain — exposed brick, rattan, handwritten menu board".
- Lighting too flat → add "golden hour window, light source at 45° from left, warm shadow from right".
- Creator too stiff/posed → add "natural relaxed posture, slight lean on elbow, conversational not performative".
- Product looks out of place → integrate product with cafe props: "product next to latte cup on marble table".
- Aspirational feels pretentious → soften with BM slang: "aku pun budget-conscious tau, tapi this one worth it".

## Persona + voice fit
- **urban-hijabi-bestie** + achernar: aspirational Muslim lifestyle — cafe aesthetic with tudung = massive saves.
- **inspirational-soft** + callirrhoe: wellness/lifestyle brand voice, almost journalistic calm.
- **polished-pro** + achird: male premium lifestyle creator, watches/accessories/skincare male demo.

## Cultural notes
- Cafe scene = high-save content for MY TikTok — aesthetic locations drive saves > 2x.
- Penang cafes: street art backdrop = free aesthetic bonus. Georgetown vibe = aspirational but local.
- Hijabi creator in cafe = normalised, dominant female UGC aesthetic in MY. Avoid bare-shoulder outfits if targeting Muslim brands.
- Ramadan: cafe content still works — pivot to "selepas berbuka" or late-night cafe social moment.
- CNY: swap rattan for CNY red-and-gold prop accent for seasonal variation.
`,
};
