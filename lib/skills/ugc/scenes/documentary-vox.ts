import type { Skill } from "../../types";

export const sceneDocumentaryVox: Skill = {
  id: "documentary-vox",
  kind: "scene",
  tab: "ugc",
  title: "Documentary Vox — Cinéma Vérité Testimonial",
  triggers: ["documentary", "testimonial", "real customer", "case study", "vox pop", "candid", "16mm", "handheld", "behind the scenes", "small business", "real story"],
  body: `# Documentary Vox Scene

**Best for:** case-study testimonials, "real customer story" content, behind-scenes brand profiles, family/restaurant/small-business vignettes, halal product skeptic-to-believer arcs.
**Best persona:** Skeptic Converted, Ibu Muda, Mak Cik Converter.
**Best voice:** callirrhoe (neutral grounded), enceladus (warm maternal), achird (older male, gravitas).

## Setting block (paste into prompt body)
"Subject in their real environment — home kitchen, small shop, modest living room, or neighbourhood street. Available light only: window spill, single practical lamp, open doorway. Slight 16mm grain feel. Environment lived-in and authentic — minor clutter acceptable, adds credibility."

## Camera + framing
- Handheld micro-jitter movement — slight organic sway, NOT stabilised.
- OR locked tripod with documentary medium shot — waist-up, slight headroom.
- NEVER selfie POV — kills the documentary feel entirely.
- 35mm natural lens, slight grain, available light. No colour grade warmth boost — let reality show.
- Observational cut-away: hands doing a task, product on shelf, environment detail.

## Lighting
"Available light ONLY — window spill, room lamp, open doorway ambient. No softbox. No ring light. 'Practical only.' Slight underexposure acceptable — realistic, not polished."

## Action beats (8s)
- 0–2s : Wide establishing shot — subject in their environment, doing something real (washing dishes, arranging product, talking to someone off-camera).
- 2–5s : Subject doing real activity. Candid mid-action. Camera drifts slightly to follow — observational energy.
- 5–7s : Pull in to candid close-up of subject's face during genuine reaction OR detail shot of hands, product, or context object.
- 7–8s : Subject's quiet moment of reflection — slight pause, soft breath, real emotion. No forced smile.

## Dialog patterns (Malay/EN code-switch — unscripted feel)
**Opener (false-start welcome):**
- "Uh, jadi macam ni la ceritanya... aku memang skeptikal dulu."
- "Macam mana nak cakap eh — aku tak sangka, serius."
- "Korang nak tau tak kenapa aku still guna sampai sekarang? Jap, aku cerita."

**Core (natural pauses, genuine tone):**
- "Lepas... uh, lepas dua minggu kot — aku nampak beza. Tak tipu, memang nampak."
- "Anak aku yang perasan dulu. Dia cakap, 'Ibu nampak lain sikit.' Bila dia cakap, baru aku perasan."
- "Aku cuba sebab kawan rekemen. Memang... memang berkesan. Tak sangka boleh jadi macam ni."

**Outro (quiet, not salesy):**
- "Itu je. Korang boleh cuba sendiri — link ada. Tapi aku tak paksa, korang decide."
- "Kalau korang rasa nak try, aku suggest try dulu. Aku tak rugi pun share benda ni."
- "Tak banyak yang aku boleh cakap lagi — result tu yang bercakap sendiri."

## Audio (5-layer)
- Dialogue: ONE voice, natural cadence — false starts, pauses, breath audible. NOT smooth voiceover quality.
- SFX: "soft ambient kitchen clatter, page turn, spoon on pot, distant call to prayer if applicable, door creak".
- Ambience: "real room tone — fridge hum, outdoor birds, light traffic, air-cond compressor, children's voices distant".
- Music: none preferred, or single sustained cello/oud note under the last 2 seconds only — never melodic score.
- Negatives: "no smooth presentation voice, no studio reverb, no dramatic music score, no applause".

## Veo prompt skeleton
"Handheld micro-jitter medium shot, 35mm, 16mm grain. <PERSONA_DESCRIPTOR> in their real home environment — <SETTING DETAIL>. Available window light only, slight underexposure. Subject speaks directly to camera with natural pauses. They say: '<HOOK_LINE>'. Camera drifts slightly — observational, not stabilised. Cut to close-up of subject's face, candid reaction. SFX: <AMBIENT DETAIL>. Real room tone. Voice direction: <VOICE_ID> — false starts welcome, natural pauses, no smooth voiceover quality. 9:16."

## Common failure modes (and fixes)
- Too polished delivery → explicitly write "false starts welcome, natural pauses, slight hesitation — sounds like B-roll testimonial, NOT a rehearsed voiceover".
- Selfie POV creep → add "camera operator perspective only — NEVER subject holding phone. Tripod or handheld operator behind camera".
- Over-lit, studio feel → add "available light ONLY — no softbox, no ring light, no beauty lighting. Practical sources only".
- Forced happy ending → add "subject's reflection is genuine and understated — soft smile or thoughtful expression, NOT broad grin or sales energy".
- Grain missing → add "16mm film grain texture throughout — slight softness, organic noise, NOT digital clean".

## Cultural notes
- Skeptic Converted + halal product testimonial is the highest-trust combo for Muslim Malaysian audience — "tak sangka boleh berkesan" closes conversions.
- Call to prayer ambience in background (if setting allows) signals authentic Muslim household — powerful implicit trust signal.
- Ibu Muda persona in home kitchen = instant relatability for 28-40 female segment.
- Avoid over-stylised grain during Ramadan content — keep it grounded and reflective, not cinematic-cool.
`,
};
