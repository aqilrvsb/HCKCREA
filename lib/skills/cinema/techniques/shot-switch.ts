import type { Skill } from "../../types";

export const techniqueShotSwitch: Skill = {
  id: "technique-shot-switch",
  kind: "technique",
  tab: "cinema",
  title: "Technique: Shot Switch (Multi-Shot via Phrase + Unfixed Lens)",
  triggers: [
    "shot switch",
    "multi shot",
    "multiple angles",
    "shot variety",
    "different angles",
    "cut between shots",
    "multi angle video",
    "shot change",
    "editing variety",
  ],
  body: `# Technique: Shot Switch (Multi-Shot via Phrase + Unfixed Lens)

## The Problem
Grok Imagine normally generates a single continuous camera move or static shot for the full clip duration. For marketing video requiring multiple angles or perspectives within one clip, you need to trigger Grok's multi-shot mode.

## The "Shot Switch" Activation
The exact phrase **"Shot Switch"** (capitalized, as a named directive) signals Grok to produce a sequence of different shots edited together within a single generated clip. This is a Grok community-discovered phrase that consistently produces multi-shot output.

**Must pair with:** "Unfixed lens" in Custom mode to allow Grok freedom to change framing between shots.

## Syntax
\`\`\`
Shot Switch: [Shot 1 description]. [Shot 2 description]. [Shot 3 description]. Unfixed lens.
\`\`\`

Or as a prose instruction:
"Use Shot Switch — begin with [wide establishing shot], switch to [medium], then close on [detail]. Unfixed lens. Edit rhythm: [fast/medium/slow]."

## Shot Switch Configurations

### Fast product reveal (3-shot):
"Shot Switch: wide establishing shot of product in environment → medium shot: hands holding product → extreme close-up: product detail/texture. Unfixed lens. Edit pace: cut on beat. Style: premium commercial."

### Action sequence (4-shot):
"Shot Switch: wide overhead athlete approach → tracking shot alongside at sprint → extreme close-up feet hitting ground → wide pull-back reveal of full arena. Unfixed lens. Fast cuts."

### Narrative build (3-shot slow):
"Shot Switch: exterior establishing → slow dolly into interior → intimate close-up face. Unfixed lens. Slow cut rhythm, building intimacy."

## Unfixed vs Fixed Lens Distinction
- **Fixed lens:** Camera position locked — only the scene/subject changes. Grok maintains one camera setup.
- **Unfixed lens:** Camera free to reposition between shots — enables Shot Switch multi-angle editing.
- Set in **Custom mode** only: the lens mode selector is in the Custom generation panel.

## Grok Modes for Shot Switch
- **Custom mode:** Required — only mode where Fixed/Unfixed lens is selectable
- **Aspect ratio:** Set for the output; individual shots within the Switch inherit the same ratio
- **Duration:** Longer clips (up to 15s max) give Shot Switch more time to develop multiple shots

## Success Rate
**65–75%** — Shot Switch works reliably for 2–3 shot sequences. 4+ shots become less consistent. Specify shots in narrative order (Shot Switch follows the described sequence).

## Sample Full Grok Prompt (Shot Switch)
"Commercial product video. Shot Switch — begin with wide environmental shot: a coffee cup on a wooden table in a sunlit café. Switch to medium: hands wrapping around the cup, steam rising. Switch to extreme close-up: the coffee surface, micro-bubbles and crema texture. Switch to wide: the smiling barista placing a second cup on the counter. Unfixed lens. Custom mode. Edit rhythm: cuts on musical beat, 3 seconds per shot. Style: warm, premium café aesthetic. Kodak Portra color grade. Audio: café ambiance, soft jazz, coffee pour sound."
`,
};
