import type { Skill } from "../../types";

export const cameraBulletTime: Skill = {
  id: "camera-bullet-time",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Bullet Time (Frozen Slow-Motion 360)",
  triggers: [
    "bullet time",
    "matrix effect",
    "frozen time",
    "slow motion 360",
    "time freeze camera",
    "matrix style",
    "frozen subject orbit",
    "time dilation",
  ],
  body: `# Camera Move: Bullet Time (Frozen Slow-Motion 360)

## What It Does Physically
A rig of cameras fires simultaneously around a subject, creating the illusion of the camera orbiting a frozen or near-frozen moment in time. Made iconic by *The Matrix* (1999). In video generation, this is approximated by extreme slow-motion + orbit around a nearly-static subject, with background elements also dramatically slowed or frozen. The effect: time stops while the camera moves freely through space.

## Grok Phrase Variations
1. "bullet time effect — time frozen, camera orbits slowly around [subject]"
2. "Matrix-style slow-motion 360 — subject nearly still, camera revolving"
3. "time dilation orbit — 360 around frozen moment"
4. "frozen action — camera sweeps around suspended subject"
5. "slow-motion orbit on [action]: [subject] suspended mid-[action]"
6. "bullet time: camera circles figure frozen mid-leap"
7. "temporal freeze orbit — 180 degrees around suspended moment"
8. "ultra slow-motion rotation around [subject] mid-action"

## Success Rate
**50–65% — better than regular orbit because the near-static subject helps Grok maintain consistency.** The frozen subject removes the background-rotation smearing problem. Specifying what is frozen (water droplets, hair, debris) increases fidelity.

**Tip:** Describe the frozen particles explicitly: "water droplets suspended in air," "debris frozen mid-explosion," "hair floating motionless" — these anchor Grok's understanding of the temporal freeze.

## When to Use
- **Action climax moments:** punch, jump, explosion — frozen at peak impact
- **Product reveal:** product suspended in space, camera orbiting — ultra-premium feel
- **Fashion:** model frozen mid-turn, fabric suspended, camera sweeping
- **Sports highlights:** athlete at peak performance moment, time-frozen
- **Hero character reveal:** protagonist frozen mid-action, camera showing all angles

## When NOT to Use (Anti-patterns)
- Scenes requiring continuous motion — bullet time negates kinetic energy
- Documentary or naturalistic content — too artificial and stylized
- Budget-sensitive prompts — bullet time requires more Grok tokens to generate correctly
- Simple walk or idle subjects — the freeze effect requires an action worth freezing

## Pairs With
- **Cameras:** Orbit (bullet time IS a specialized orbit)
- **Techniques:** Identity Motion Lock (keep subject consistent across the frozen orbit)
- **Moods:** Epic Fantasy, Neon Noir
- **Directors:** Ridley Scott, Villeneuve (for philosophical frozen moment)

## Sample Prompt Fragment
"Bullet time effect — a martial artist frozen mid-spinning kick, foot extended at head height, sweat droplets suspended in air around her. Camera orbits slowly 180 degrees around her frozen form, revealing her expression from the front, side, and three-quarter angle. Background blurred into slowness. Ultra slow-motion. Matrix-style time freeze orbit."
`,
};
