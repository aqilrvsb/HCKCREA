import type { Skill } from "../../types";

export const sceneTutorialHowTo: Skill = {
  id: "tutorial-how-to",
  kind: "scene",
  tab: "ugc",
  title: "Tutorial / How-To — Step-by-Step Product Use",
  triggers: ["tutorial", "how to", "step by step", "cara pakai", "skincare routine", "technique", "demo", "gadget", "supplement", "hair styling"],
  body: `# Tutorial How-To Scene

**Best for:** skincare routines, makeup techniques, supplement timing, kitchen gadgets, hair styling tools, household products.
**Best persona:** Educational Expert, Polished Pro, Urban Hijabi Bestie (akak mentor mode).
**Best voice:** callirrhoe (clear instructional), charon (male technical), enceladus (warm mom-tutorial).

## Setting block (paste into prompt body)
"Bright clean surface — bathroom vanity, kitchen counter, or desk. Products laid out neatly in order of use. Minimal props, intentional arrangement. Good task lighting — not dark, not blown-out. Feels like a knowledgeable friend showing you something useful, not a TV ad."

## Camera + framing
- Overhead top-down for hands-on demos (mixing, pouring, applying to surface) OR
- Static medium close-up tripod facing subject for technique walkthrough (face + hands both visible).
- Insert cut: extreme close-up of product tip/nozzle/texture during application step.
- 9:16 vertical. 35mm or 50mm natural lens. NO selfie POV — tripod only for credibility.

## Lighting
"Soft even key light from camera-front or slight camera-left. Clean but not clinical — warm white or daylight. No dramatic shadows that obscure hand movement."

## Action beats (8s)
- 0–2s : "Ni cara aku" hook + product reveal on clean surface, direct-to-camera, clear line.
- 2–5s : Step 1 + Step 2 demonstrated clearly — hands visible, each step distinct, no rushing.
- 5–7s : Step 3 (final step) + result reveal — before/after texture, application finish, or product output.
- 7–8s : "Settle dah" outro — product label faces camera, simple CTA.

## Dialog patterns (Malay/EN code-switch)
**Opener:**
- "Ni cara betul pakai <PRODUCT> — ramai orang silap buat step ni."
- "Step satu dulu — jangan skip, penting tau."
- "Aku nak tunjuk cara aku guna benda ni, memang lain dari selalu."

**Core:**
- "Step satu: sapu sikit je, jangan lebih. Rub perlahan-lahan, tunggu 30 saat."
- "Step dua: ni bahagian paling penting — kena betul-betul lap ke dalam, baru berkesan."
- "Step tiga: tengok hasilnya. Texture dia dah lain kan? Itu tanda dia kerja."

**Outro:**
- "Tiga step je, settle. Cuba dulu, confirm korang rasa bezanya."
- "Kalau korang nak link, ada kat beg kuning. Aku dah guna 3 minggu, memang padu."
- "Simple kan? Bukan susah pun, kena tau cara je."

## Audio (5-layer)
- Dialogue: ONE voice, measured instructional pace — not rushed, not slow.
- SFX: "soft pump click of dispenser, light tap of bottle on counter, gentle rub sound on skin, spatula scrape".
- Ambience: "quiet bathroom hum, faint water drip, or neutral room tone — clean and focused".
- Music: none preferred, or very subtle neutral background — music must NOT compete with instructions.
- Negatives: "no upbeat hype music, no audience reaction, no sped-up time-lapse sound".

## Veo prompt skeleton
"Static medium close-up, 35mm, soft even key light. <PERSONA_DESCRIPTOR> stands at a clean bathroom vanity with <PRODUCT> and supporting items laid out. She demonstrates each step clearly with hands visible. She says: '<HOOK_LINE>'. Close-up insert cut of product application texture. Soft daylight from camera-front. SFX: dispenser click, gentle rub. Ambience: quiet room tone. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes (and fixes)
- Too many steps crammed into 8s → MAX 3 steps. If product has 5+ steps, demo the single most important technique only.
- Hands not visible → add "both hands clearly in frame during application steps, no hand exits frame mid-step".
- Speedy montage feel → add "each step holds for minimum 1.5 seconds — slow enough to follow, not a highlight reel".
- Vague instructions → add exact quoted dialog lines with specific action words ("rub", "tap", "wait", "press").
- Product not identified → add "product label clearly visible in opening shot before any application begins".

## Cultural notes
- "Cara betul" framing (the correct way) triggers strong engagement — implies common mistake being fixed.
- Akak mentor tone works powerfully for female 25-40 demographic — educational but warm, not condescending.
- For supplement timing tutorials: include "sebelum makan" / "lepas makan" specifics — Malaysian audience demands precision on this.
`,
};
