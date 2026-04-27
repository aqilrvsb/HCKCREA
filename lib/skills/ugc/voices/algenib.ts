import type { Skill } from "../../types";

export const voiceAlgenib: Skill = {
  id: "algenib",
  kind: "voice",
  tab: "ugc",
  title: "Voice: Algenib — Male, Gravelly, Low Pitch, Deep Rough",
  triggers: ["algenib", "male", "gravelly", "low pitch", "deep", "rough", "rugged", "masculine", "fitness", "authority"],
  body: `# Voice: Algenib

## Character archetype
Male. Low pitch, gravelly — the rough-textured voice of someone who has done the work. Not artificially deep (no voice-drop performance), naturally gravelly like actual physical effort lives in the voice. Age read: 26-38. Radiates no-nonsense credibility. "I've earned the right to say this" energy.

## Best persona pairings
- \`gym-bro\` — canonical match. Post-workout gravelly delivery = instant physique credibility.
- \`skeptic-converted\` — male version, gravelly + measured = hardest-to-fake credibility combo.
- \`polished-pro\` — male version where authority is physical rather than intellectual.

## Best scene pairings
- Post-workout direct-to-cam (pump still visible, slight breathlessness)
- Supplement unboxing / scoop test
- Before/after physique reveal (voiceover)
- "What I've actually tested" review (no fluff)
- Morning ritual — supplement + coffee + camera

## Sample BM-EN dialog (3 lines)
1. "Weh — lepas chest day baru ni, nak cakap sikit pasal supplement yang aku dah guna 6 minggu."
2. "Pump lagi lama. Recovery pun lebih cepat. Aku tak cakap kalau aku tak rasa sendiri."
3. "Link dalam bio. Aku dah repeat order 3 kali. Korang decide sendiri."

## Voice direction line (inject verbatim into Veo prompts)
"Voice direction: Algenib — male, low pitch, gravelly rough texture, measured confident delivery, slight post-exertion breathiness, no affectation or performance."

## Pairings to AVOID
- \`confessional-intimate\` — gravelly low is too assertive for the vulnerability space.
- \`product-whisperer\` — ASMR format requires softness; gravelly disrupts sensory calm.
- \`inspirational-soft\` — emotional uplift requires warmth, not roughness.
- \`comedic-foodie\` — rough gravelly reads as dry/deadpan, kills comedic timing. Gacrux is the hype male.
- Any female-coded persona.
`,
};
