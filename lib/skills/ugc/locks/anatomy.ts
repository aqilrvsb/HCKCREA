import type { Skill } from "../../types";

export const lockAnatomy: Skill = {
  id: "anatomy",
  kind: "lock",
  tab: "ugc",
  title: "Anatomy Lock (Human Body Integrity)",
  triggers: ["anatomy", "fingers", "hands", "face", "body", "limbs", "skin", "plastic", "distortion"],
  body: `# Anatomy Lock

## The exact lock text
\`\`\`
2 hands with 5 fingers each, symmetric face, no missing limbs, no plastic skin, natural skin texture with visible pores, realistic joints
\`\`\`

## Why it exists
Veo's most consistent failure mode in UGC scenes is human anatomy distortion. Without this lock, the model defaults to rendering:
- Hands with 6-7 fingers (occurs in ~40% of unguided close-up shots)
- Plastic-smooth skin (looks like CGI, immediately breaks UGC authenticity)
- Asymmetric faces (one eye drooping, misaligned jaw)
- Missing fingers when hand is near product
- Melted/merged fingers in grip shots

For Malaysian UGC, close-up hand shots are essential (product application, bottle hold, tap gesture). Anatomy failures in these shots destroy the take entirely.

## When to disable / soften
- **Cartoon scene** (if a user explicitly requests animated/illustrative style): remove the "5 fingers" constraint — cartoon hands often have 4
- **Abstract / bokehed background shot** (no hands visible, face not prominent): can drop "5 fingers" since hands aren't in frame
- **Silhouette scene**: anatomy lock irrelevant, omit to save token budget
- **Product-only flatlay**: no human anatomy in frame, omit entirely

## Veo failure if absent
Scene: creator applies serum. Without lock → left hand on bottle shows 7 fingers fused at the tips, skin on forearm has airbrushed wax texture. Full take is unusable. Required re-generation 3x.

## Notes
Always keep "natural skin texture with visible pores" even when other parts are softened — plastic skin is the single easiest tell that content is AI-generated and kills trust in Malaysian UGC audiences who are highly attuned to filter vs. real.
`,
};
