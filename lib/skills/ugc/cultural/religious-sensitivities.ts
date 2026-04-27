import type { Skill } from "../../types";

export const culturalReligiousSensitivities: Skill = {
  id: "religious-sensitivities",
  kind: "cultural",
  tab: "ugc",
  title: "Religious Sensitivities — Malaysian Muslim Hard Avoids",
  triggers: ["religion", "religious", "islam", "muslim", "haram", "sensitive", "alcohol", "pork", "mahram", "hijab", "aurat"],
  body: `# Religious Sensitivities — Cultural Guardrail

## When to fetch
Fetch whenever: product is consumed/applied by body, creator is visibly Muslim (hijabi), audience is Malay-Muslim demographic, content involves physical interaction between genders, any food/drink product, or any content touching on Islamic lifestyle.

## Hard avoids — absolute (never generate under any condition)
- **Alcohol visible in frame**: wine glass, beer can, cocktail, even "mocktail" in an ambiguous glass — if it looks like alcohol to a Muslim viewer, it IS a problem
- **Pork-adjacent background**: butcher shop with pork display, restaurant with non-halal signage visible, ham/bacon props
- **Non-mahram physical contact**: male creator touching female creator who is not his spouse/family — handshake, shoulder touch, any contact. Even implied closeness in UGC framing.
- **Hijabi showing hair**: if creator wears hijab, NO hair visible at any point — not at the sides, not from wind, not pinned back casually showing ears
- **Hijabi showing past-wrist skin**: long sleeves required. Avoid wrist-to-elbow exposed skin.
- **Performative Islamic phrases on dubious products**: using "Alhamdulillah", "MasyaAllah", "InsyaAllah" to sell products with unverified halal status or dubious efficacy claims — audiences and regulators notice
- **Music with explicit lyrics or romantic themes** during any religious content framing
- **Images or mockery of Islamic symbols**: crescent, Quran, prayer items — never used as props for product placement

## Agent redirect rule
**If user requests content involving any of the above:** Stop generation and propose:
> "This content element conflicts with Muslim audience sensitivities and may also violate TikTok MY community guidelines. Propose alternative: [specific safe alternative]. Shall I regenerate with that framing?"

## Performative religiosity — the nuanced hard avoid
Using Islamic phrases as marketing amplifiers on products that:
- Have no halal certification
- Make unverifiable health claims
- Are positioned as "spiritual" supplements without basis

This is one of the fastest ways to trigger viral backlash in Malaysian Muslim communities. The audience is sophisticated — they recognize when religiosity is being leveraged commercially without sincerity.

**Safe use of Islamic phrases:**
- "InsyaAllah berkesan" — only if creator genuinely practices; feels authentic
- "Alhamdulillah, result dia memang nampak" — gratitude expression after genuine result
- "Selamat dicuba" — simple blessing, low risk
- Avoid: "MasyaAllah cantiknya hasil dia" said while selling an uncertified whitening cream

## Modesty in Veo prompts
When generating hijabi creator content, always include in Veo prompt:
\`\`\`
Creator wears hijab fully covering hair and neck. Long sleeves covering wrists. Modest clothing with no body-contouring fabric. No skin visible below jawline except face and hands.
\`\`\`

## Mixed-gender content rules
- Solo creator format preferred for all UGC categories — avoids mahram issues entirely
- If two creators required (husband-wife pair is acceptable and actually a trust booster for family products)
- Male-female duo: must be stated as husband and wife OR siblings, and physical proximity must be modest (no touching, no leaning)

## Platform-specific notes
TikTok MY is more conservative than TikTok globally. Content that passes US/EU moderation may still:
- Get reported by Malaysian users en masse
- Trigger loss of LIVE commerce privileges
- Cause reputational damage in the Malay-Muslim community that is nearly impossible to recover from

When in doubt, remove. The cost of a regeneration is far lower than the cost of a viral backlash.
`,
};
