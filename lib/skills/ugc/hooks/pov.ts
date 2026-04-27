import type { Skill } from "../../types";

export const hookPov: Skill = {
  id: "pov",
  kind: "hook",
  tab: "ugc",
  title: "POV Hook (First-Person Immersion)",
  triggers: ["pov", "point of view", "first person", "immersion", "relatable scenario", "situational", "lifestyle"],
  body: `# POV Hook

**Pattern:** "POV: korang baru jumpa..." — drops viewer INTO a moment. First-person situational immersion that makes the viewer the protagonist.
**Why it works:** Forces the viewer to self-insert. Brain processes "POV" as personal memory retrieval, not ad consumption. Lowest skip rate in first 1.5s for 18-34 Malaysian women.

## Hook phrase library (verified active 2025-26)
1. "POV: korang nak pergi date tapi jerawat baru keluar semalam."
2. "POV: kau jumpa produk yang wish jumpa 5 tahun awal."
3. "POV: korang cuci muka pagi tadi pastu terus rasa regret."
4. "POV: baru dapat gaji, tapi kulit still sama macam bulan lepas."
5. "POV: BFF korang tanya skincare routine korang padahal 3 bulan lepas kulit korang tenat."
6. "POV: korang scroll FYP at 2am sebab tak boleh tidur sebab rasa tak confident."
7. "POV: kau tengok mirror sebelum interview, rasa nak cancel."
8. "POV: pakwe cakap 'you nampak lain' — and for once it's a good thing."
9. "POV: first time wipe micellar cotton and it's still clean."

## Beat math (first 2s only)
- Word count: 6-10 words MAX — "POV:" is 1 word, scenario fills the rest
- Delivery: "POV:" spoken flat/low (0–0.5s), scenario delivered with slight rise (0.5–2s)
- Visual: face or hands visible at 0s; POV implies camera = viewer's eyes — maintain direct gaze or first-person hand shot

## Structural rules
- ALWAYS start with exactly "POV:" — the colon is load-bearing for recognition
- ALWAYS place viewer in a SPECIFIC moment, never an abstract state
- NEVER describe what happened — describe what the viewer is FEELING or DOING right now
- NEVER resolve the moment in the hook — tension must carry into second 3-5

## Pairs best with
- Frameworks: DITL (Day-in-the-Life), BAB-Extended, SSS (Star-Story-Solution)
- Personas: Casual Bestie, Urban Hijabi Bestie, Confessional Intimate
- Scenes: Bedroom Storytime, Bathroom Mirror, Morning Routine

## Pitfalls
- AVOID POV scenarios that are too aspirational — "POV: dah jadi influencer" reads as fake
- AVOID resolving the POV in the hook itself ("POV: korang dah jumpa produk terbaik") — kills tension
- AVOID non-visual POVs — viewer must be able to SEE themselves in it
- AVOID staged/perfect lighting — POV works best with natural, candid visual treatment

## Veo prompt insertion
Place in scene setup field. Example:
"POV handheld shot, early morning bathroom, she looks at mirror and says: 'POV: korang cuci muka pagi tadi pastu terus rasa regret.' Natural light only, slightly shaky camera."
`,
};
