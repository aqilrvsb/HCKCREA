import type { Skill } from "../../types";

export const cameraDronefpv: Skill = {
  id: "camera-drone-fpv",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Drone FPV (First-Person View Aerial)",
  triggers: [
    "drone fpv",
    "fpv drone",
    "aerial weaving",
    "fast aerial",
    "chase drone",
    "fpv racing",
    "freestyle drone",
    "aerial chase",
    "drone fly through",
  ],
  body: `# Camera Move: Drone FPV (First-Person View Aerial)

## What It Does Physically
A small racing/freestyle drone with a forward-facing camera flies at high speed through environments — weaving between trees, through windows, under bridges, around vehicles. The camera rolls and pitches aggressively with the drone's maneuvers. The result is a visceral, immersive first-person perspective that feels like flying, diving, or pursuing at machine speed.

## Grok Phrase Variations
1. "FPV drone shot, camera weaving through [environment]"
2. "freestyle drone fly-through, aggressive banking turns"
3. "aerial FPV chase, camera pitching and rolling through space"
4. "racing drone perspective, low altitude, high speed"
5. "drone dives through [gap/window/canyon], FPV roll"
6. "immersive aerial weave, camera banks left then dives"
7. "FPV freestyle, drone barrel rolls past subject"
8. "aerial first-person: camera swoops down then banks hard right"

## Success Rate
**60–70% for simple FPV trajectories (dive, swoop, fly-through).** Grok handles FPV movement when the path is clearly described. Complex multi-axis maneuvers (flip, barrel roll mid-flight) drop to ~40% fidelity. Specify entry and exit point for best results.

**Hyper Motion connection:** FPV requires Hyper Motion adverbs to prevent Grok defaulting to slow aerial. Add: "rapidly," "at high speed," "diving aggressively," "sweeping quickly" to unlock kinetic aerial energy.

## When to Use
- **Action sports:** skateboarding, mountain biking, motorsports — FPV follows athlete
- **Architecture/real estate:** immersive fly-through of interior or exterior
- **Chase sequences:** camera is the pursuer, subject is fleeing
- **Brand energy statements:** speed, technology, freedom, innovation
- **Product launches:** dramatic fly-in reveal of product or environment
- **Event coverage:** festival, race, construction timelapse flyover

## When NOT to Use (Anti-patterns)
- Calm, contemplative, or atmospheric content — FPV energy destroys stillness
- Intimate human emotion — too mechanical and distant
- Environments with complex fine detail — fast FPV motion blurs detail into abstraction
- Luxury brand positioning that requires elegance — FPV reads aggressive, not refined

## Pairs With
- **Techniques:** Hyper Motion (essential for fast FPV), Shot Switch (cut from FPV to ground-level)
- **Moods:** Epic Fantasy (aerial over landscape), Neon Noir (night FPV through city)
- **Cameras:** Combine FPV approach with dolly-in arrival for two-phase reveal

## Sample Prompt Fragment
"FPV drone shot — camera dives rapidly from above the treeline, banking hard left through a gap between buildings, leveling out at street level and screaming toward the neon-lit market at high speed. Aggressive aerial weave, camera rolling with the turns. Immersive first-person aerial perspective. Audio: wind rush, drone motor whine, crowd noise rising as it approaches."
`,
};
