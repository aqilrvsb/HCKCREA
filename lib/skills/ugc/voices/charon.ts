import type { Skill } from "../../types";

export const voiceCharon: Skill = {
  id: "charon",
  kind: "voice",
  tab: "ugc",
  title: "Voice: Charon — Male, Deep, Authoritative",
  triggers: ["charon", "male", "deep", "authoritative", "authority", "credible", "baritone", "serious", "formal", "expert male"],
  body: `# Voice: Charon

## Character archetype
Male. Deep baritone, unhurried, authoritative. The "you listen when he speaks" voice. Not aggressive or cold — authoritative warmth, like a doctor you trust or a professor who actually cares. Age read: 32-50. Commands attention without raising volume. Natural credibility anchor for claims that need intellectual backing.

## Best persona pairings
- \`educational-expert\` — male version; deep authoritative delivery makes ingredient science land as fact, not opinion.
- \`polished-pro\` — male version at the premium end; higher authority register than achird.
- \`skeptic-converted\` — male version for high-skepticism categories (finance, medical-adjacent, high-ticket).

## Best scene pairings
- Ingredient / mechanism explainer (numbered breakdown)
- "Why I switched" rational analysis narrative
- Supplement / health product with clinical backing
- Premium product review (higher price point justification)
- Comparison / debunking format ("the myth vs. the reality")
- Any scene where authority = conversion (health, finance-adjacent, professional tools)

## Sample BM-EN dialog (3 lines)
1. "Ada sebab kenapa niacinamide jadi bahan paling dicari dalam skincare sekarang. Bukan trend — ada sains di sebaliknya."
2. "Produk ni ada 5% concentration — that's the range backed by published research for sebum regulation."
3. "Kalau korang serious pasal hasilnya, link ada. Baca ingredient list dulu — verify sendiri."

## Voice direction line (inject verbatim into Veo prompts)
"Voice direction: Charon — male, deep baritone, authoritative calm delivery, measured pacing, no rush, warm authority without coldness, intellectually credible."

## Pairings to AVOID
- \`casual-bestie\` — deep authority destroys the peer-casual energy entirely.
- \`comedic-foodie\` — baritone comedy needs very specific scripting; default is a mismatch.
- \`confessional-intimate\` — vulnerability space requires softness; charon reads as composed/guarded.
- \`product-whisperer\` — ASMR requires achernar's soft airiness; deep baritone is too present and grounded.
- Any female-coded persona.
`,
};
