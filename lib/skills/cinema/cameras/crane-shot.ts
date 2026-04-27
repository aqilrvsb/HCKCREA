import type { Skill } from "../../types";

export const cameraCraneShot: Skill = {
  id: "camera-crane-shot",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Crane Shot (Vertical Reveal)",
  triggers: [
    "crane shot",
    "vertical reveal",
    "camera rising",
    "epic reveal",
    "bird eye reveal",
    "lift camera",
    "ascending shot",
    "reveal from above",
    "jib shot",
  ],
  body: `# Camera Move: Crane Shot (Vertical Reveal)

## What It Does Physically
The camera is mounted on a crane (or jib) and moved vertically — typically rising from ground level to a high elevated position (or descending in reverse). The vertical movement reveals scale: what seemed like a contained scene expands into a vast landscape, battlefield, crowd, or environment. The crane shot is cinema's declaration of epic scale.

## Grok Phrase Variations
1. "crane shot rising above subject"
2. "camera lifts vertically, revealing scale below"
3. "jib shot ascending, environment revealed"
4. "camera cranes up, pulling back to reveal vast [landscape/crowd/city]"
5. "vertical reveal — camera rises from low to high"
6. "ascending overhead shot, scale expanding"
7. "slow crane up, intimate to epic in one move"
8. "camera climbs above rooftop, city revealed below"

## Success Rate
**65% — reliable for simple vertical movement, less reliable for simultaneous rise + reveal of complex environment.** Specify the start and end framing clearly (e.g., "begins tight on face, rises to reveal entire city below").

## When to Use
- **Epic scale reveals:** start on a small detail (face, product, doorway) and rise to reveal the world it exists within
- **Triumph moments:** athlete winning, brand launch — camera rising = victory
- **Environment establishment:** reveal a landscape, city, or crowd that wasn't visible at ground level
- **Emotional resolution:** rising camera signals release, transcendence, conclusion
- **God's-eye conclusion:** end a film/sequence by lifting away from characters into the wider world

## When NOT to Use (Anti-patterns)
- Intimate, close-quarters scenes — crane removes proximity and warmth
- Horror — rising camera relieves tension rather than building it (unless used subversively)
- Fast action — crane movement is inherently slow and deliberate
- Indoor product shots — vertical travel needs vertical space

## Pairs With
- **Directors:** Villeneuve (scale reveal), Leone (epic western landscape), Ridley Scott (dystopian city reveal)
- **Moods:** Epic Fantasy, Neon Noir (city scale)
- **Cameras:** Combine with drone handoff for continuous vertical-to-aerial

## Sample Prompt Fragment
"Camera: crane shot — begins close on her face looking up, then rises slowly. As camera ascends, the full stadium crowd below is revealed — 80,000 people, all looking toward her. Camera continues rising until she is a tiny figure amid the vast crowd. Epic vertical reveal, slow and deliberate."
`,
};
