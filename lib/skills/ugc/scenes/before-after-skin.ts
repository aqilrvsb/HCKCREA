import type { Skill } from "../../types";

export const sceneBeforeAfterSkin: Skill = {
  id: "before-after-skin",
  kind: "scene",
  tab: "ugc",
  title: "Before / After Skin — Two-Panel or Temporal Transformation Reveal",
  triggers: ["before after", "transformation", "skin", "results", "glow up", "acne", "dark spots", "reveal", "comparison"],
  body: `# Before / After Skin Scene

**Best for:** skincare (acne, dark spots, uneven tone, dullness), collagen drinks, supplements, hair growth, weight management — any product with a visible result arc.
**Best persona:** confessional-intimate, skeptic-converted, inspirational-soft.
**Best voice:** achernar (female soft), callirrhoe (female mid neutral), charon (male deep auth).

## Setting block (paste into prompt body)
"Two distinct visual segments: BEFORE — bedroom or bathroom, flat ring-light or natural window, no makeup, skin texture visible and unfiltered. AFTER — same location, same angle, same lighting to ensure fair comparison. Creator expression: before = low-energy, subdued; after = natural confidence, slight smile. No dramatic filter shift between panels."

## Camera + framing
- Static medium close-up, IDENTICAL position both panels — tripod lock, no repositioning.
- Two-panel split screen OR temporal cut (before → product intro → after sequence).
- Face fills 70% of frame — skin texture must be readable.
- 9:16 vertical. 35mm. Stabilised — skin comparison requires zero shake between panels.

## Lighting
"CRITICAL: same lighting for both panels. Natural window diffuse (5000K) or consistent ring light. No makeup/filter in before. No retouching in after — same conditions to preserve trust. Before: expression neutral, no product. After: product visible, confidence expression."

## Action beats (8s)
- 0–2s: "Before" — creator faces camera, no makeup, honest expression. Hook: "Korang nak tengok? Ni muka aku sebelum [PRODUCT]."
- 2–4s: Quick transition — calendar wipe or jump cut forward in time. Product shown briefly.
- 4–6s: "After" — same framing, same lighting. Creator tilts chin, cheek toward camera. Skin visible improvement shown.
- 6–8s: Creator faces camera directly, natural confidence. Specific result described. Product to camera. CTA.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s, "before" state):**
- "Okay jangan gelak — ni betul-betul muka aku 3 minggu lepas."
- "Korang, aku dah lama tak confident selfie sebab kulit aku macam ni..."
- "Ni honest review — before dulu, then aku tunjuk lepas."

**Core (4-6s, "after" reveal):**
- "Sama orang, sama angle, beza? [PRODUCT] selama 21 hari."
- "Dark spots kat pipi kiri tu — tengok sekarang. Memang fade, aku tak tipu."
- "Kulit aku tak perfect lagi, tapi progress dia real — aku nampak beza, orang lain pun tegur."

**Outro (6-8s):**
- "Tekan beg kuning — halal, no harsh chemicals, aku buktikan dah."
- "Korang decide — tapi aku tak akan stop pakai ni. Link in bio."
- "3 minggu je — bayangkan 3 bulan. Jom try sama-sama."

## Audio (5-layer)
- Dialogue: ONE speaker — before voice: quieter, hesitant slightly. After voice: same person, more confident (tone direction only, not performance).
- SFX: "calendar page flip (transition), product lid click, serum pump, gentle tap on cheek".
- Ambience: "bedroom natural quiet — consistent across both panels, same room tone, confirms same location".
- Music: soft understated piano during before, gentle lift (same track, different section) during after reveal.
- Negatives: "no dramatic transformation music sting, no before-ugly-sound effect, no applause".

## Veo prompt skeleton
"Static medium close-up, 35mm, LOCKED tripod position — same framing both segments. Segment 1: <PERSONA_DESCRIPTOR> no makeup, natural skin visible, subdued expression. She says: '<HOOK_LINE>'. Calendar-wipe transition. Segment 2: same creator, same angle, same lighting — skin noticeably improved, natural confidence smile, tilts chin to show cheek. Holds <PRODUCT>. Diffused window light 5000K consistent. SFX: page flip transition, serum pump. Ambience: same room tone both segments. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Different lighting between panels = kills trust → lock light source: "same window, same time of day, overcast preferred for consistency".
- Before looks too bad (performatively ugly) → "natural authentic before — real skin, not exaggerated bad lighting".
- After looks over-filtered → "after segment: no filter, no airbrushing — same skin texture visible, just improved".
- Time gap unclear → add title card: "Day 1" / "Day 21" — visual timestamp builds believability.
- Specificity missing → script exact result: "acne marks reduced by visible margin — no active breakouts in after segment".

## Persona + voice fit
- **confessional-intimate** + achernar: highest trust — vulnerability in before, quiet pride in after.
- **skeptic-converted** + callirrhoe: "I didn't think it would work for my skin type — proof here."
- **inspirational-soft** + charon: male before/after skincare — growing niche, high scroll-stop for novelty.

## Cultural notes
- Malaysian skin tone diversity: specify Morena/Sawo matang skin in prompt — fairer skin only representation is a trust gap. Inclusive representation = +saves.
- Halal skincare: after panel — show halal cert if product is skincare. Muslim audience actively screens ingredient list.
- Before/after is TikTok MY Tier-1 format — highest conversion format for skincare category bar none.
- Avoid: exaggerated before (unethical expectation-setting) — KKM Malaysia may flag misleading health claims.
- Raya season: "glowing skin for raya" is the highest-intent angle — start campaign 3-4 weeks before Eid.
`,
};
