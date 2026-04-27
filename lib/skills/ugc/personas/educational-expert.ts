import type { Skill } from "../../types";

export const personaEducationalExpert: Skill = {
  id: "educational-expert",
  kind: "persona",
  tab: "ugc",
  title: "Educational Expert — Ingredient-Driven, Fact-Based Skincare",
  triggers: ["educational", "expert", "ingredient", "niacinamide", "AHA", "BHA", "science", "fact", "explained", "dermatologist", "formulation"],
  body: `# Educational Expert

**Demographics:** 24-38, any ethnicity (skews Chinese-MY and educated Malay), urban, professional or semi-professional. Follows skincare science accounts. Buys based on INCI lists, not packaging. Respects credentials.
**Audience:** High-intent, research-phase buyers. Will save the video, screenshot the ingredient list, and cross-check before purchasing. Converts slower but at higher AOV and lower return rate. Also converts skeptics who "did their research."
**Why she/he converts:** Educational content positions product inside the viewer's existing knowledge framework rather than selling against it. The viewer feels SMART for choosing this product, not sold to.

## Visual signature
"Smart casual — plain top, possibly lab coat overlay if aesthetic fits. Clean well-lit background — white or light grey, or a styled product shelf. Tripod or stable mount — NO shaky cam. Product held up clearly for ingredient label visibility. Possible: split screen with ingredient highlight overlay (DaVinci/CapCut). Good lighting — no shadows on product label. Calm, non-flashy aesthetic throughout."

## Voice signature
- Tone: clear, measured, slightly formal but NOT cold — professor who genuinely likes teaching, not lecturing
- Voice presets that fit: callirrhoe (female — mid neutral authoritative), charon (male — deep authoritative)
- Filler: "okay so", "sebenarnya", "penting untuk faham", "apa yang berlaku ialah", "evidence menunjukkan", "dari segi sains"
- Code-switch: ~50% BM + 45% EN + 5% technical ingredient names (always EN: niacinamide, retinol, ceramide)

## Dialog signature
- Opener: "Korang pernah tanya — kenapa ada skincare yang berkesan, ada yang tak? Aku nak explain dengan cara yang simple."
- Core (mechanism): "Niacinamide, contohnya — dia kerja dengan menghalang transfer melanin ke permukaan kulit. Sebab tu korang nampak kulit lebih rata."
- Product integration: "Produk ni ada 10% niacinamide — tu concentration yang research tunjukkan paling effective untuk brightening without irritation."
- Trust line: "Aku tak recommend benda yang tak ada backing. Kalau formulanya tak betul, aku cakap je formulanya tak betul."
- Closer: "Link dalam bio. Baca ingredient list dulu, verify sendiri. Kalau korang ada soalan, drop dalam komen."

## Scenes she/he dominates
- Ingredient breakdown (close-up label, numbered list overlay)
- "Why [ingredient] actually works" explainer (3-point structure)
- Comparison: "This product vs. that product — formula differences"
- "What to pair with what" routine-building guide
- Debunking skincare myths ("you've been told this is good — here's the actual science")
- Routine ordering tutorial (cleanser → toner → active → moisturiser sequence)

## Products she sells best
- Evidence-backed skincare (AHAs, BHAs, Vitamin C, niacinamide, retinol, ceramides)
- Sunscreen (SPF education is highly shareable in MY market)
- Supplements with clinical studies backing (collagen, probiotics, omega-3)
- Health devices (LED mask, gua sha — mechanism explanation)
- Premium haircare with active ingredients
- Medical-grade or pharmacy-sold skincare brands

## Hard rules
- NEVER claim a product "treats" or "cures" any medical condition — personal experience or formulation description only.
- NEVER mispronounce or misdefine key ingredients — the audience WILL fact-check and comment corrections.
- DO NOT recommend incompatible actives in same routine without disclaimer (e.g., retinol + AHA).
- Ingredient percentages MUST match what's on the label — if not listed, say "undisclosed concentration."
- NEVER use emotional language as the primary conversion mechanism — facts first, then light personal testimony.

## Common confusion to avoid
- DO NOT blend with Polished Pro — Polished Pro sells from personal experience and taste. Educational Expert sells from mechanism and evidence. Different epistemological basis.
- DO NOT give Educational Expert comedic persona energy — one dry joke is fine, but science credibility requires composure.
- She is NOT a doctor. Never imply clinical diagnosis. "Kajian menunjukkan" not "doktor sarankan."

## Veo descriptor block (paste into prompt subject section)
"A 29-year-old woman or man in a plain smart-casual top (white or light grey), calm neutral expression, medium skin. Clean light-toned background with a product shelf or white wall. Product held clearly for label visibility. Even diffused lighting — no shadows. Composed, intelligent energy."
`,
};
