import type { Skill } from "../../types";

export const lockProductRef: Skill = {
  id: "product-ref",
  kind: "lock",
  tab: "ugc",
  title: "Product Reference Lock (Label & Visual Fidelity)",
  triggers: ["product", "label", "packaging", "brand", "color", "logo", "typography", "bottle", "consistency", "drift"],
  body: `# Product Reference Lock

## The exact lock text
\`\`\`
Product is pixel-identical to reference image — same color, shape, label text, typography, and cap design maintained consistently across all frames. No label drift, no color shift, no text warping between cuts.
\`\`\`

## Why it exists
Product consistency is Veo's second-hardest problem after anatomy. Without a hard lock, the model treats product appearance as a soft constraint and allows:
- Label text to warp, blur, or generate plausible-looking fake text that differs from the real label
- Color shifting between frames (teal bottle in frame 1, aqua in frame 3)
- Shape changes (pump bottle becomes flip-cap)
- Logo shrinking or repositioning on the packaging
- Typography style shifting between frames

In Malaysian e-commerce content, label accuracy is a legal and trust requirement. Consumers cross-reference the TikTok video against the product they receive — inconsistency triggers return requests and review complaints.

## When to disable / soften
- **No-product scene** (persona-only, educational talking head): omit entirely — no product in frame
- **Atmospheric/lifestyle B-roll** (product blurred in background intentionally): soften to "product color palette consistent, label not required to be legible"
- **Abstract product reveal** (product silhouetted or obscured by design): soften to "product silhouette shape consistent"

## Veo failure if absent
Scene: creator holds up vitamin bottle showing label. Frame 1: label reads correctly. Frame 3: label text has shifted to generic "VITAMIN C 1000mg" in wrong font. Frame 5: bottle has changed from amber glass to white plastic. All frames unusable — legal and brand issue.

## Notes
Always pair this lock with an actual reference image input. The lock text alone improves consistency; reference image input + lock text approaches near-perfect fidelity across a single scene. Without the image, the model invents the product.
`,
};
