import type { Skill } from "../../types";

export const hookRoastHotTake: Skill = {
  id: "roast-hot-take",
  kind: "hook",
  tab: "ugc",
  title: "Roast / Hot Take Hook (Contrarian Opinion)",
  triggers: ["roast", "hot take", "unpopular opinion", "overrated", "controversial", "contrarian", "honestly", "harsh truth", "skeptic"],
  body: `# Roast / Hot Take Hook

**Pattern:** "Unpopular opinion: ni produk paling overrated..." — stakes a bold, contrarian position that provokes comment and watch-through. The speaker positions as the one person willing to say what others won't.
**Why it works:** Controversy triggers the brain's disagreement circuit — people watch to rebut OR to feel validated. Comment-bait is built-in. Highest comment-rate hook category for saturated product categories.

## Hook phrase library (verified active 2025-26)
1. "Unpopular opinion: SPF50 yang korang pakai tu buang duit je."
2. "Ni produk paling overrated kat Malaysia 2025 — aku cakap based on ingredient."
3. "Hot take: vitamin C serum mahal yang korang beli tu tak beza dari yang RM25."
4. "Aku nak roast diri sendiri dulu — aku dulu juga tertipu."
5. "Kalau korang pakai cleanser tu, aku faham kenapa kulit korang tak improve."
6. "Maaf cakap tapi collagen tu marketing je kalau korang tak buat benda ni sekali."
7. "Semua orang nak promote ni tapi takde sapa nak cakap pasal side effect dia."
8. "Honest review yang takde sapa berani bagi — ni sebenarnya."
9. "Aku tak faham kenapa orang still beli brand tu lepas tau pasal ni."

## Beat math (first 2s only)
- Word count: 7-12 words — opinion marker first ("unpopular opinion / hot take"), claim second
- Delivery: slightly smug, conspiratorial tone — not angry; the speaker knows something others don't
- Visual: direct gaze, slight raised eyebrow; subtle smirk signals "I'm about to say something spicy"

## Structural rules
- ALWAYS back the hot take with evidence in the body — opinion without proof = comment-bait with no conversion
- ALWAYS name the thing being roasted specifically (product category, ingredient, behavior)
- NEVER roast a specific named brand in a paid ad context
- Position speaker as "truth-teller" not "hater" — the roast must serve the viewer

## Pairs best with
- Frameworks: MBT (Myth-Bust-Truth), ARP (Authority-Recommend-Proof), PAS
- Personas: Skeptic-Converted, Educational Expert, Roast persona
- Scenes: Educational talking-head, Ingredient flat-lay, Side-by-side comparison

## Pitfalls
- AVOID roasting without receipts — "overrated" must be backed by specific claim within 5s
- AVOID roasting medical professionals or targeting protected groups
- AVOID pure negativity — end must pivot to solution or it's just complaint content
- AVOID using for medical devices or prescription-adjacent categories (regulatory risk)

## Veo prompt insertion
Conspiratorial, slightly leaning back posture. Example:
"Slight smirk, raised eyebrow, she says: 'Unpopular opinion: SPF50 yang korang pakai tu buang duit je.' Cut to ingredient label close-up at second 3."
`,
};
