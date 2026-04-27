import type { Skill } from "../../types";

export const culturalHalalProducts: Skill = {
  id: "halal-products",
  kind: "cultural",
  tab: "ugc",
  title: "Halal Products — Certification & Trust Signals",
  triggers: ["halal", "halal certified", "jakim", "ingredient", "gelatin", "alcohol", "carmine", "muslim", "certification", "logo"],
  body: `# Halal Products — Cultural Guardrail

## When to fetch
Fetch this skill whenever user input contains: "halal", "JAKIM", "muslim consumer", "ingredient list", "gelatin-free", "alcohol-free", "carmine-free", "halal certified", "muslim audience", "hijabi creator", or any supplement/food/cosmetic product marketed to Malay-Muslim consumers.

## Hard avoids
- **Never show product with ambiguous ingredient**: if gelatin, carmine (E120), or alcohol-based preservative is in the formula, do NOT make halal claims without certification
- **Never display competitor's halal logo**: using another brand's certification framing causes legal exposure
- **Never say "InsyaAllah halal"** for uncertified products — implied claim without proof triggers regulatory risk (Akta Perihal Dagangan)
- **Never use pork-adjacent imagery** in any shot even as background (e.g. restaurant with visible non-halal menu, shot glass in background)
- **Never fake or mock-up a JAKIM logo** — even for visualization; use text references only unless real logo is available from brand assets

## Safe patterns that convert
1. **Halal logo first-5s placement**: show JAKIM / BERNAS / HALAL MY logo in opening 5 seconds → removes objection before viewer raises it. Conversion lift: significant for Muslim-majority audience.
2. **Hijabi creator as embedded trust anchor**: hijabi presenting a product implicitly signals Muslim-safe without needing to state it explicitly. Most powerful trust signal available.
3. **Ingredient transparency narration**: "No gelatin, no carmine, no alcohol-based preservative — aku check sendiri sebelum aku guna." Converts 40%+ better than claim alone.
4. **Gentle blessing close**: "Selamat dicuba, InsyaAllah berkesan." — authentic if creator practices Islam. Do NOT script this for non-Muslim creators — sounds performative.
5. **Certification number mention**: "JAKIM cert number [XXX], boleh verify sendiri." — highest credibility signal for supplement and food categories.

## Halal logo / certification handling
- **JAKIM** (Jabatan Kemajuan Islam Malaysia): gold standard for Malaysian halal certification. Recognized nationally.
- **BERNAS / State Islamic Authority certs**: secondary certs, still valid, less universally recognized.
- **Foreign halal certs** (MUI Indonesia, IFANCA USA): recognized but require explanation for skeptical Malaysian audience.
- Logo placement in video: first 5 seconds OR product close-up shot. Never obscured. Never in bottom 25% (covered by TikTok UI).
- If brand has cert but hasn't provided logo: creator says "certified halal, nombor sijil dekat description" — do not fabricate the visual.

## Veo prompt insertion
For halal product content, add to scene description:
"Halal certification logo visible on product label in the first 5 seconds. Creator wears hijab. Natural home setting. Ingredient transparency: creator reads label showing 'no gelatin' clearly to camera."

## Sample dialog adjustments
- Standard skincare close: "Texture dia ringan — and yang penting, halal certified, no alcohol. Aku check ingredients dulu sebelum share dengan korang."
- Supplement pitch: "JAKIM certified — cert number ada dekat description. Bahan dia clean, no pork derivatives. InsyaAllah selamat."
- Food product: "100% halal, semua ingredients dah aku verify. Rasa dia pun sedap, tak ada weird aftertaste."
`,
};
