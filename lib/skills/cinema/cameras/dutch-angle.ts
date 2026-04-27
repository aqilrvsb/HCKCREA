import type { Skill } from "../../types";

export const cameraDutchAngle: Skill = {
  id: "camera-dutch-angle",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Dutch Angle (Canted Frame)",
  triggers: [
    "dutch angle",
    "tilted frame",
    "canted shot",
    "psychological unease",
    "tilted camera",
    "off balance composition",
    "villain framing",
    "unease camera",
  ],
  body: `# Camera Move: Dutch Angle (Canted Frame)

## What It Does Physically
The camera is rotated along its horizontal axis — tilting the horizon line so it is no longer level. A 10–20° tilt signals mild unease; 30–45° signals strong disorientation; beyond 45° approaches abstraction. No physical movement of the camera position — only rotation. Named for German Expressionist cinema (Deutsch, corrupted to "Dutch").

## Grok Phrase Variations
1. "dutch angle, tilted frame"
2. "canted camera, horizon off-axis"
3. "tilted perspective, psychological unease"
4. "camera rolled [X] degrees off horizontal"
5. "German Expressionist tilt"
6. "oblique framing, disoriented perspective"
7. "sinister canted angle, [subject] dominant"
8. "world tilted, frame unstable"

## Success Rate
**70% — Grok understands "dutch angle" well but may undercommit to the tilt.** Specify degree or intensity ("strongly tilted," "extreme dutch angle") to get clear effect.

## When to Use
- **Villain or antagonist framing:** dutch angle visually codes a character as threatening or unstable
- **Psychological horror:** environmental dread before a reveal
- **Surreal/dream sequences:** reality distorted, logic failing
- **Power imbalance scenes:** oppressive character over subordinate
- **Reveal of wrongness:** something that looks normal but is deeply off

## When NOT to Use (Anti-patterns)
- Hero or aspirational character framing — tilt undercuts authority
- Product showcase requiring clean geometry — tilted frame makes products look crooked
- Romantic or warm emotional content
- Landscapes and architecture where horizontal lines matter
- Overuse: multiple dutch angles in one video cancels the psychological effect

## Pairs With
- **Directors:** Lynch (uncanny dread), classic horror aesthetics
- **Eras:** 40s Noir (Expressionist shadow + dutch angle)
- **Moods:** Atmospheric Dread, Surreal Dream
- **Technique:** combine with handheld for maximum disorientation

## Sample Prompt Fragment
"Camera: strong dutch angle, frame tilted 25 degrees, horizon line cutting diagonally across the scene. The figure looms in the upper portion of the tilted frame. Psychological unease. German Expressionist tilt. Hold static."
`,
};
