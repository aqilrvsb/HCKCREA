import type { Skill } from "../../types";

export const lockUgcAuthenticity: Skill = {
  id: "ugc-authenticity",
  kind: "lock",
  tab: "ugc",
  title: "UGC Authenticity Lock (Anti-Studio Signal)",
  triggers: ["authenticity", "ugc", "iphone", "handheld", "amateur", "natural", "studio", "softbox", "real", "organic"],
  body: `# UGC Authenticity Lock

## The exact lock text
\`\`\`
Authentic amateur iPhone UGC — handheld arm's-length, natural soft window light or warm indoor LED, slight camera shake, no stabilizer, no tripod look, no studio setup. Feels like real person talking to phone, not a production.
\`\`\`

## Why it exists
Veo's default output skews toward "polished video" when not constrained. For UGC content, polished = killed. Malaysian TikTok audiences in the skincare/wellness/supplement category specifically distrust over-produced content because:
1. It reads as a paid ad (algorithm de-boosts; viewer skips)
2. It breaks parasocial trust (real people don't have softboxes in bedrooms)
3. It signals that the product can't sell itself with honest reviews

The studio signal includes: perfectly even lighting, zero camera movement, professional framing at eye level, crisp shallow depth-of-field from a cinema lens. All of these are authentic-feel killers.

## When to disable / soften
- **Expert/brand video** (if user explicitly wants professional look for brand channel): remove; replace with "clean corporate presenter style, professional lighting"
- **Educational whiteboard / screen-share style**: authenticity lock irrelevant; omit
- **Cinematic lifestyle B-roll** (not UGC, explicitly cinematic): remove; use cinema skill locks instead
- **Product flatlay shot** (no person): "arm's-length" irrelevant, keep only "natural lighting, no softbox"

## Veo failure if absent
Scene: creator reviews supplement in bedroom. Without lock → Veo renders a softbox-lit three-point studio setup, perfectly stabilized camera, salon-quality hair. Creator looks like she's in a commercial. TikTok algorithm may still serve it, but comment section: "ni memang iklan lah" — trust destroyed, no conversion.

## Notes
"Slight camera shake" is the single most important token in this lock. It is the primary signal that distinguishes "real person" from "production." Even a 1-pixel frame-to-frame movement reads as human. Veo will fake this well when instructed.
`,
};
