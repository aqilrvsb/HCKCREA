import type { Skill } from "../../types";

export const voiceAchird: Skill = {
  id: "achird",
  kind: "voice",
  tab: "ugc",
  title: "Voice: Achird — Male, Friendly, Mid Pitch, Warm",
  triggers: ["achird", "male", "friendly", "mid pitch", "warm", "approachable", "conversational", "natural male"],
  body: `# Voice: Achird

## Character archetype
Male. Mid-pitch — not deep-authoritative, not high-energetic. The vocal sweet spot of the "friendly guy next door who actually knows his stuff." Warm and conversational. Sounds like a trusted friend explaining something over kopi, not a salesman. Age read: 24-34.

## Best persona pairings
- \`chinese-malaysian-codeswitcher\` — male version; warm mid-pitch fits the trilingual natural cadence.
- \`skeptic-converted\` — male version; warmth + credibility = ideal arc delivery.
- \`casual-bestie\` — male equivalent of chatty bestie; approachable peer energy.
- \`polished-pro\` — softer version of polished authority; less formal than charon.

## Best scene pairings
- Café storytime (product on table, relaxed)
- "My honest review after 6 weeks" direct-to-cam
- Product comparison (friendly analytical, not dry)
- Unboxing with live commentary
- Morning routine featuring health supplement

## Sample BM-EN dialog (3 lines)
1. "Serious ah — aku dah test benda ni almost 2 bulan sebelum nak cakap anything."
2. "Aku bukan jenis yang recommend semua benda. Tapi yang ni, 真的有差 (really different)."
3. "Check link dalam bio lah. Worth it, trust me on this one."

## Voice direction line (inject verbatim into Veo prompts)
"Voice direction: Achird — male, mid pitch, warm friendly tone, natural conversational pacing, approachable peer energy, no affectation."

## Pairings to AVOID
- \`mak-cik-converter\` — this is a mature female persona; voice mismatch.
- \`confessional-intimate\` — that space belongs to achernar (female soft) or a significantly softer male delivery.
- \`comedic-foodie\` — gacrux owns the hype-male space; achird is too measured for peak comedy energy.
- \`product-whisperer\` — achernar is canonical for ASMR; achird's warmth is too present for that format.
`,
};
