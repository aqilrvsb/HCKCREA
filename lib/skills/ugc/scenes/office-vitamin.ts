import type { Skill } from "../../types";

export const sceneOfficeVitamin: Skill = {
  id: "office-vitamin",
  kind: "scene",
  tab: "ugc",
  title: "Office Desk — Vitamin / Supplement Micro-Moment",
  triggers: ["office", "vitamin", "desk", "supplement", "workplace", "energy", "immune", "vitamin c", "collagen"],
  body: `# Office Vitamin Scene

**Best for:** vitamin C, collagen drinks, energy supplements, eye-care products, herbal wellness, productivity supplements, skincare from within.
**Best persona:** polished-pro, casual-bestie, urban-hijabi-bestie.
**Best voice:** callirrhoe (female mid neutral), achernar (female soft), achird (male warm).

## Setting block (paste into prompt body)
"Modern Malaysian open-plan office, mid-afternoon slump hour (2–4pm). Desktop monitor glowing behind creator, keyboard and notebook visible on desk. Overhead fluorescent cool-white light mixed with warm monitor screen glow from behind. Coffee cup and stationery on desk as natural props."

## Camera + framing
- Static medium close-up: phone propped against monitor or on small desk stand, eye level.
- Slight low angle (camera at desk surface, looking up slightly) — makes creator look confident and competent.
- 9:16 vertical. 35mm natural. Minimal camera shake — office = more composed than gym.

## Lighting
"Cool fluorescent overhead (4000K), warm monitor glow from camera-rear creating rim light. Slight under-eye shadow from overhead — add 'small LED panel fill from camera-left at desk level' if skin tone needs lift."

## Action beats (8s)
- 0–2s: Creator looks at camera from desk, slightly tired but aware — hook line about the afternoon slump.
- 2–5s: Reaches for product, pops vitamin or pours drink sachet. Close-up of tablet/liquid.
- 5–7s: Takes product, sits back, visible relief expression — tension leaves face.
- 7–8s: Back to work confidently. Label shown. Outro CTA.

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s):**
- "Korang pernah tak rasa penat gila tengah hari padahal meeting belum habis?"
- "2pm office struggle is real — tapi aku ada secret weapon."
- "Eh jap — sebelum aku teruskan kerja, nak tunjuk benda yang save my afternoon."

**Core (2-5s):**
- "[PRODUCT] ni aku minum setiap hari — confirm energy naik balik, tak ngantuk dah."
- "Vitamin C dia 1000mg, collagen included — kulit pun nampak lagi cerah bila kerja depan screen lama."
- "Rasa dia sedap, tak bitter — aku dissolved dalam air, minum macam air cordial je."

**Outro (7-8s):**
- "Tekan beg kuning, free delivery — aku dah restock tadi."
- "Link in bio, halal cert ada — aman je."
- "Try satu bulan — confirm korang tak nak stop."

## Audio (5-layer)
- Dialogue: ONE speaker, measured professional-casual pace — not rushed.
- SFX: "keyboard typing, mouse click, pill packet tear, glass set on desk, sachet pour into water".
- Ambience: "office AC hum, distant keyboard clatter, faint printer, low background chatter".
- Music: none, or very light lo-fi at −20dB during B-roll only.
- Negatives: "no loud office noise, no phone ringing, no distracting background conversations".

## Veo prompt skeleton
"Static medium close-up, 35mm, phone on desk stand at eye level. <PERSONA_DESCRIPTOR> at a modern Malaysian office desk, monitor glowing behind. Reaches for <PRODUCT>, pops vitamin or pours sachet into water glass. Sips, visible relief. He/She says: '<HOOK_LINE>'. Overhead fluorescent cool-white, warm monitor rim-light from behind. SFX: sachet tear, glass on desk. Ambience: AC hum, distant keyboard. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Office looks too generic/Western → add "Malaysian open-plan office — batik print on wall, whiteboard with BM text, Milo tin on desk".
- Creator looks too stiff → add "natural seated posture, slight forward lean toward camera when speaking".
- Product disappears in dark desk → add "product placed on white notebook or light-coloured mouse pad for contrast".
- Screen glare ruins face → specify "monitor turned slightly away from creator so screen doesn't backlight face".
- Afternoon fatigue looks too dramatic → dial back: "subtle tiredness — eye rub, slight slouch before product".

## Persona + voice fit
- **polished-pro** + callirrhoe: office authority, speaks to working professionals, B2B-adjacent trust.
- **urban-hijabi-bestie** + achernar: huge MY female workforce demo — hijab + blazer combo = aspirational working woman.
- **casual-bestie** + iapetus: Gen-Z desk worker, relatable slump humor, lighter tone.

## Cultural notes
- Malaysian working culture: 9-5 plus OT is common — "sampai lewat office" resonates.
- Halal status of supplements is important — show logo or mention "no gelatin, halal certified" in script.
- Collagen + whitening vitamins = top-selling wellness category for Malaysian female professionals. Lead with skin benefit if targeting this demo.
- CNY/Raya office season: gift-set angle works — "belanja colleague pun boleh" as soft CTA variation.
`,
};
