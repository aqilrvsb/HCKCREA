import type { Skill } from "../../types";

export const techniqueHyperMotion: Skill = {
  id: "technique-hyper-motion",
  kind: "technique",
  tab: "cinema",
  title: "Technique: Hyper Motion (Adverb Intensity Unlock)",
  triggers: [
    "hyper motion",
    "fast action",
    "kinetic energy",
    "explosive movement",
    "action video",
    "fast camera",
    "high energy",
    "dynamic motion",
    "action sequence",
    "speed unlock",
  ],
  body: `# Technique: Hyper Motion (Adverb Intensity Unlock)

## The Problem
Grok Imagine defaults to **slow motion** for all generated video. Without intervention, a "running figure" becomes a graceful slow-motion drift. An "explosion" becomes a cinematic, unhurried bloom. This is Grok's prior — it has learned that slow motion = cinematic quality. To unlock kinetic energy, you must explicitly override this prior using adverb intensity.

## The Adverb Unlock Mechanism
Motion intensity in Grok is governed by the adverbs and intensity modifiers attached to action descriptions. The model weights motion energy from the language in the first 20–30 words of the prompt.

### Transformation examples:
| Slow (default) | Hyper Motion unlocked |
|---|---|
| "car passing" | "car **passing quickly**" |
| "wing flapping" | "wing **flapping greatly**" |
| "figure running" | "figure **sprinting with all his strength**" |
| "explosion" | "explosion **erupting violently outward**" |
| "water splashing" | "water **exploding upward with force**" |
| "crowd cheering" | "crowd **erupting wildly, arms flying**" |

### Master Adverb Library (most effective first):
**Speed:** quickly, rapidly, at high frequency, fast, swiftly
**Force:** violently, powerfully, forcefully, explosively, thunderously
**Amplitude:** with large amplitude, greatly, wildly, enormously
**Fullness:** sprinting with all his strength, erupts into motion, with maximum force

### Suppressor phrases to AVOID (these kill kinetic energy):
- "slow motion" — directly invokes Grok's default
- "static tripod" — removes camera energy
- "locked frame" — removes all motion
- "calm pacing" — suppresses intensity
- "subtle," "gentle," "softly" — reduces amplitude
- "floating gently" — overrides fast motion

## Grok Modes That Affect Motion
- **Normal mode:** Balanced — still defaults to slow, needs adverbs
- **Fun mode:** More variation — slightly more likely to produce unexpected kinetic energy
- **Custom mode + Unfixed lens:** Required for camera movement techniques; also helps motion energy
- **Speed mode:** Rapid iteration — useful for testing hyper motion variants
- **Quality mode (April 2026):** 4 simultaneous high-quality outputs — use for selecting best hyper motion take

## Full Hyper Motion Prompt Structure
Lead with intensity. Put the kinetic action in the first sentence.

**Template:**
"[High-energy subject] [adverb-loaded action]. [Camera at matching energy]. [Style]. [Motion descriptors reinforcing speed]. Audio: [matching high-energy sound]."

## Sample Grok Imagine Prompt (Hyper Motion)
"Hyper-fast action sequence. Handheld shaky camera follows a samurai sprinting forward with all his strength. Motion blur on legs and sword arm. Purple lightning effects erupting violently around him. Debris flying toward the camera explosively. High shutter speed. Camera: aggressive handheld chase, rapidly tracking his sprint. Style: high-contrast cinematic action. Audio: sword clashes, arcane energy crackling, thunder, impact sounds."

## Combining with Other Skills
- **Drone FPV:** FPV requires hyper motion adverbs — "camera diving rapidly," "sweeping aggressively"
- **Tracking Shot:** "background streaming past rapidly" unlocks sprint-level tracking
- **Whip Pan:** Inherently hyper-motion; add "camera whips violently" for full smear
- **Orbit/Bullet Time:** Inverse — use suppressor phrases to keep subject frozen while camera moves
`,
};
