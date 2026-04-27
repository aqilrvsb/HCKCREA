import type { Skill } from "../../types";

export const cameraTrackingShot: Skill = {
  id: "camera-tracking-shot",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Tracking Shot (Lateral Follow)",
  triggers: [
    "tracking shot",
    "lateral follow",
    "follow cam",
    "side tracking",
    "dolly alongside",
    "parallel move",
    "kinetic follow",
    "running alongside",
  ],
  body: `# Camera Move: Tracking Shot (Lateral Follow)

## What It Does Physically
The camera moves laterally — parallel to the subject's direction of movement — keeping the subject in frame while background slides past. Creates a sense of momentum, speed, and kinetic energy. Unlike the dolly-in (which closes distance), the tracking shot maintains distance while moving with the subject. Background motion blur indicates speed.

## Grok Phrase Variations
1. "tracking shot — camera moves alongside subject"
2. "lateral tracking, subject in frame as background blurs past"
3. "camera follows subject from the side, parallel movement"
4. "dolly alongside running subject, kinetic energy"
5. "tracking shot, background streaming past"
6. "side-by-side follow cam, speed implied by background blur"
7. "parallel tracking, subject centered, environment in motion"
8. "car window tracking shot, subject running alongside"

## Success Rate
**70% — reliable at moderate speeds.** Grok handles lateral movement well at walking-to-jogging pace. At running speed, request "motion blur on background" to anchor the velocity visually. Fast sprinting may require hyper-motion adverbs (see Hyper Motion technique).

**Speed calibration with background blur:**
- "background gently drifting" — walk pace
- "background blurring softly" — jog
- "background streaming past in motion blur" — sprint
- "background smearing with speed" — vehicle-speed

## When to Use
- **Chase sequences:** camera tracks alongside pursuer or prey
- **Walk-and-talk scenes:** character movement + dialogue simultaneously
- **Product moving through environment:** car, skateboard, bicycle
- **Fashion runway:** camera tracking alongside model
- **Athletic performance:** runner, cyclist, athlete in motion

## When NOT to Use (Anti-patterns)
- Static subjects — tracking shot implies movement; use orbit or dolly instead
- Intimate close-up emotion — lateral movement creates reportage distance, not intimacy
- Environments with complex background geometry — smearing artifacts likely
- Very fast action where you want frame-by-frame clarity — tracking blur may obscure detail

## Pairs With
- **Directors:** Wong Kar-wai (slow tracking for romance), Ridley Scott (atmospheric tracking through markets)
- **Cameras:** Combine with handheld shake for urgent chase feel
- **Moods:** Neon Noir (night tracking through city), Epic Fantasy (alongside horse/creature)
- **Technique:** Hyper Motion adverbs to push from walk to sprint energy

## Sample Prompt Fragment
"Camera: lateral tracking shot alongside the motorcycle as it rides down the neon-lit street — camera at street level, parallel to the bike, background streaming past in motion blur. Subject stays centered in frame. Speed: fast, background smearing with velocity."
`,
};
