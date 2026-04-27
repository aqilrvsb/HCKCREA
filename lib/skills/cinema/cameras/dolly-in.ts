import type { Skill } from "../../types";

export const cameraDollyIn: Skill = {
  id: "camera-dolly-in",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Dolly-In (Push-In)",
  triggers: [
    "dolly in",
    "push in",
    "slow forward",
    "building tension",
    "intimacy camera",
    "zoom in cinematic",
    "forward camera move",
    "close in",
  ],
  body: `# Camera Move: Dolly-In (Push-In)

## What It Does Physically
The camera moves forward on a physical track or slider (dolly) toward the subject. Unlike a zoom — which changes focal length — a dolly-in moves the entire camera, so perspective changes: background elements expand, parallax shifts, and the subject grows larger organically. The effect is psychological intimacy, revelation, or escalating tension.

## Grok Phrase Variations (most reliable first)
1. "slow dolly-in toward subject" — most reliable phrasing
2. "slow push-in on face"
3. "camera slowly advancing toward [subject]"
4. "gradual forward camera movement, building intimacy"
5. "push-in, camera creeping forward"
6. "slow forward tracking shot toward [subject]"
7. "camera moves in slowly, [subject] filling frame"

## Success Rate
**85% — most reliable camera move in Grok Imagine.** Grok consistently produces clean forward push-ins without smearing or distortion. This is the safest move to specify when you need camera motion.

## When to Use
- **Revelation moments:** subject is revealed as camera approaches — face, product, detail
- **Tension escalation:** slow push into a face conveys growing psychological pressure
- **Intimacy establishment:** product or person becomes the world as camera advances
- **Speech/emotion emphasis:** pair with a subject speaking or feeling — push-in amplifies
- **Hero product shot:** camera advancing toward product gives it cinematic weight

## When NOT to Use (Anti-patterns)
- Fast action scenes — dolly-in reads as slow and deliberate; kills kinetic energy
- Wide landscape/environment shots where you want spatial awareness to grow (use crane or drone instead)
- Comedy punchline delivery — push-in telegraphs seriousness
- When multiple subjects need equal framing — dolly-in favors one focal point

## Pairs With
- **Directors:** Wong Kar-wai (slow intimate push on face), Villeneuve (slow advance on monolith), Leone (extreme push toward eyes)
- **Moods:** Romantic Intimate, Atmospheric Dread, Neon Noir
- **Film stocks:** Kodak Portra 400 (skin warmth on push), CineStill 800T (neon push)

## Sample Prompt Fragment
"Camera: slow dolly-in toward her face, neon bokeh expanding behind her, foreground blur dissolving as she fills the frame. Hold final frame 2 seconds."
`,
};
