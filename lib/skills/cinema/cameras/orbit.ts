import type { Skill } from "../../types";

export const cameraOrbit: Skill = {
  id: "camera-orbit",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Orbit (Arc / 360)",
  triggers: [
    "orbit",
    "360 camera",
    "arc shot",
    "circle around subject",
    "orbit shot",
    "360 around",
    "revolve around",
    "360 product shot",
  ],
  body: `# Camera Move: Orbit (Arc / 360)

## What It Does Physically
The camera maintains a fixed distance from the subject while rotating around it — a circular tracking shot. Partial orbit (45–180°) reveals the subject's depth and environment. Full 360° creates a triumphant or god-like reveal. The background rotates behind the subject, showing context from all angles.

## Grok Phrase Variations
1. "camera orbits around subject" — standard phrasing
2. "360-degree arc shot around [subject]"
3. "camera circles [subject], revealing background"
4. "slow orbit, subject centered, background rotating"
5. "arc shot, 180 degrees around"
6. "camera sweeps around subject in a wide arc"
7. "slow 360 product reveal, camera orbiting"

## Success Rate
- **Simple isolated subject:** 80% — Grok handles orbit well when subject is clean against simple background
- **Complex scene with multiple elements:** 55% — background complexity causes inconsistent rotation; environment may shift or smear
- **Full 360 on complex scene:** ~40% — reliability drops significantly; consider 90–180° arc instead

**Recommendation:** For complex scenes, use partial arc (90°) and specify "Unfixed lens" in Custom mode to improve rotation fidelity.

## When to Use
- **Product reveal:** camera orbiting a product gives premium, commercial-quality feel
- **Character reveal:** orbit on hero character establishes power and presence
- **Triumph moments:** 360 orbit on an athlete, entrepreneur, or protagonist signals achievement
- **Architecture showcase:** partial arc reveals spatial scale
- **"Isolated subject" product shots:** clean background = high success rate

## When NOT to Use (Anti-patterns)
- Busy street scenes or crowded environments — smearing artifacts likely
- When you need subject emotion to read clearly — orbit splits attention to environment
- When background continuity matters — orbit will reveal inconsistencies in generated environments
- Fast orbit — Grok smears fast pan movements above ~30% speed; keep orbit slow

## Pairs With
- **Directors:** Villeneuve (monolith orbit), Ridley Scott (dystopian environment reveal)
- **Moods:** Epic Fantasy, Neon Noir (single subject in environment)
- **Techniques:** Bullet Time (for frozen slow-motion orbit)

## Sample Prompt Fragment
"Camera: slow orbit — 180 degrees around the product, product centered and sharp, studio background rotating softly behind. Unfixed lens. Camera speed: slow, smooth arc. Reveal product sides progressively."
`,
};
