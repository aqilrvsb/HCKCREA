import type { Skill } from "../../types";

export const sceneGrwm: Skill = {
  id: "grwm",
  kind: "scene",
  tab: "ugc",
  title: "GRWM — Get Ready With Me, Dressing Table, Product Applied",
  triggers: ["grwm", "get ready with me", "makeup", "skincare routine", "dressing table", "mirror", "morning routine", "beauty"],
  body: `# GRWM Scene

**Best for:** skincare, makeup, haircare, fragrance, modest fashion accessories, hijab styling products, any beauty/personal care product applied during prep.
**Best persona:** urban-hijabi-bestie, casual-bestie, polished-pro.
**Best voice:** achernar (female soft), iapetus (female Gen-Z), callirrhoe (female mid neutral).

## Setting block (paste into prompt body)
"Personal dressing table or vanity area, morning or evening. Large mirror reflecting creator from behind — dual angle naturally. Skincare and makeup products arranged on table. Ring light or large round LED softbox from front (mirror-mounted or freestanding). Warm ambient bedroom light. Creator in comfortable home outfit — pre-going-out look."

## Camera + framing
- Mirror selfie or phone propped against mirror: captures both face and reflection — dual-angle in one shot.
- Static medium close-up from tripod: 35mm, creator centred, vanity table visible below frame.
- Occasional close-up B-roll on hands applying product to face/skin.
- 9:16 vertical. 35mm natural. Mirror reflections = GRWM signature framing.

## Lighting
"Front-facing ring light (5600K daylight) mounted or placed in front — classic GRWM even lighting. Warm bedroom ambient from behind for hair-light rim. Dual lighting (cool front + warm back) creates the flattering "beauty YouTuber" contrast that is TikTok GRWM standard."

## Action beats (8s)
- 0–2s: Creator faces mirror/camera, speaks hook mid-task (applying toner, adjusting hijab pin, etc.) — never stopping to address camera formally.
- 2–5s: Picks up product, applies to skin or uses in hair/on fabric. Describes product while applying — multi-task authenticity.
- 5–7s: Shows result in mirror — tilts head, checks coverage, approving nod. "Nampak tak bedah?" moment.
- 7–8s: Final look — faces camera directly, product in hand. Outro. Smile.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Korang, GRWM — aku nak keluar dalam 20 minit ni, cepat."
- "Okay tengok, kulit aku tadi macam ni — lepas pakai [PRODUCT] jap eh."
- "Hijab aku belum okay lagi — jap, sambil tu aku share skincare step aku."

**Core (2-5s):**
- "So step kedua aku — [PRODUCT] ni. Aku dabbed kat area T-zone, lembap gila tapi tak greasy."
- "Serum dia pun best — aku apply gently, dah nampak glow sikit dalam masa 30 saat."
- "Foundation coverage pun lagi smooth bila guna moisturiser ni sebagai base — confirm diff."

**Outro (7-8s):**
- "Tu la routine aku sekarang — [PRODUCT] wajib. Tekan beg kuning."
- "Ready! — link in bio kalau nak sama-sama cantik."
- "Okay siap — korang lagi cantik dari aku, tapi cuba je."

## Audio (5-layer)
- Dialogue: ONE speaker — conversational, multi-task pacing (speaks while applying, not a monologue).
- SFX: "serum pump, compact click, brush on skin, hijab pin click, hairdryer (distant), liquid pour".
- Ambience: "bedroom morning — faint traffic, AC low hum, occasional bird, music from adjacent room (very low)".
- Music: trending beauty/chill pop lofi, −16dB under speech. Can surface during non-talking B-roll.
- Negatives: "no dramatic music, no echo, no crowd, no harsh ring light HF noise".

## Veo prompt skeleton
"Static medium close-up, 35mm, phone propped at mirror. <PERSONA_DESCRIPTOR> at dressing table in hijab home outfit, applying <PRODUCT> to face/skin in front of large mirror. Dual view — face forward and reflection behind. Dabs serum, checks coverage in mirror, approving nod. He/She says: '<HOOK_LINE>'. Front ring light 5600K, warm bedroom ambient rim from behind. SFX: serum pump, compact click. Ambience: bedroom morning quiet, AC hum. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Ring light visible in eyes (too obvious) → "ring light from above-front at 45°, not straight-on — reduces circular catchlight".
- Mirror creates confusing depth → "creator faces slightly angled toward camera — mirror reflection at 30° offset".
- Hijab styling looks rushed → dedicate 1-2s B-roll: "adjusting hijab pin close-up — meditative, not rushed".
- Product application looks aggressive → "gentle dabbing motion — upward strokes, not rubbing".
- Skin result invisible → specify: "close-up on T-zone after application — subtle glow visible on cheekbone".

## Persona + voice fit
- **urban-hijabi-bestie** + achernar: GRWM hijabi saves +35% vs non-hijabi for MY female audience — highest performance.
- **casual-bestie** + iapetus: Gen-Z GRWM — fast-paced, chaotic good, relatable morning panic energy.
- **polished-pro** + callirrhoe: structured GRWM — professional woman, work-ready look tutorial hybrid.

## Cultural notes
- Hijabi GRWM = dominant MY female UGC format — hijab styling steps + skincare = double-value content.
- Halal makeup: Muslim audience specifically looks for halal cosmetics — mention "wudhu-friendly" or "halal-certified" if applicable.
- Saves: GRWM drives highest saves in beauty category — audience saves to rewatch routine steps.
- Ramadan: GRWM pivots to "siap untuk terawih" or "baju raya GRWM" — highest Raya content format.
- Male GRWM (grooming): emerging subformat — beard care, skincare for men — male creator + achird voice works.
`,
};
