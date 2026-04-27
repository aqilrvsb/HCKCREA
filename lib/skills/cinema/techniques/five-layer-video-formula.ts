import type { Skill } from "../../types";

export const techniqueFiveLayerVideoFormula: Skill = {
  id: "technique-five-layer-video-formula",
  kind: "technique",
  tab: "cinema",
  title: "Technique: Five-Layer Video Formula (Grok Prompt Architecture)",
  triggers: [
    "five layer formula",
    "grok prompt formula",
    "prompt structure",
    "how to prompt grok",
    "video prompt architecture",
    "grok video prompt",
    "prompt template",
    "prompt formula",
    "how to write grok prompt",
  ],
  body: `# Technique: Five-Layer Video Formula (Grok Prompt Architecture)

## Why Grok Needs a Formula
Grok Imagine processes natural language sentences, NOT bracket tags or comma-separated lists. The model weights the **first 20–30 words most heavily** — they are the highest-influence part of the prompt. Everything after functions as modifier and style context. A well-structured prompt layers information in decreasing influence order: what the scene IS comes first, how it MOVES comes last.

**Critical rule:** Use natural language sentences, not:
- ~~[subject: woman] [style: cinematic] [mood: dark]~~ — bracket syntax ineffective
- ~~woman, cinematic, dark, moody, neon~~ — tag stacking underperforms
- ~~Negative: no blur, no grain~~ — negative prompts are largely ineffective; use positive alternatives

## The Five Layers

### Layer 1: SCENE (What exists — who, where, what)
The subject + setting + core action in the first 1–2 sentences. This carries the heaviest weight.

**Format:** "[Subject with specific visual descriptors] [action verb] [in/at setting with specific descriptors]."

**Example:** "A young woman in a flowing white dress walks barefoot through a shallow stream in a dense green rainforest."

---

### Layer 2: CAMERA (How we see it)
Camera move + position + framing. Name the move explicitly.

**Format:** "Camera: [named move]. [Position description]. [Framing]."

**Example:** "Camera: slow tracking shot alongside her at water level, keeping her centered as the stream bends."

---

### Layer 3: STYLE / LIGHTING (The aesthetic)
Film stock, director reference, era, lighting description. Stack compatible references.

**Format:** "[Film stock]. [Director aesthetic]. [Lighting description]. [Color palette]."

**Example:** "Shot on Kodak Portra 400 — warm creamy skin tones, cyan-green shadows in the forest. Golden hour light filtering through tree canopy. Shallow depth of field, forest bokeh."

---

### Layer 4: MOTION (How things move — energy and tempo)
This is where Hyper Motion adverbs live. Describe the motion quality of the scene elements.

**Format:** "[Subject motion adverb]. [Environmental motion]. [Camera energy descriptor]."

**Example:** "She moves slowly, water parting gently around her feet. Leaves drifting softly in the canopy above. Camera drifts with the current, unhurried."

*For action content:* "She sprints explosively forward, water erupting around her feet. Camera aggressively tracking, rapidly matching her speed."

---

### Layer 5: AUDIO (What we hear)
Grok Imagine generates audio natively — specify it explicitly for best results.

**Format:** "Audio: [ambient sound], [specific sounds], [music style/genre]."

**Example:** "Audio: flowing stream water, bird calls, light wind through leaves, distant soft gamelan."

---

### Optional Layer 6: STABILITY CONSTRAINT
Add only when needed to prevent Grok from drifting from your specifications.

**Format:** "[Character name] remains [constant descriptor] throughout."

**Example:** "Aisha's emerald blouse and cream trousers remain consistent throughout."

---

## Full Five-Layer Assembly Example

**Layer 1 (Scene):** "A street food vendor flips roti canai on a hot iron griddle at a bustling Kuala Lumpur night market at 9pm."

**Layer 2 (Camera):** "Camera: slow dolly-in toward the griddle, beginning wide to show the market crowd, ending in extreme close-up on the roti surface."

**Layer 3 (Style):** "Shot on CineStill 800T — tungsten neon-noir, red halation on the gas flame. Warm amber light from the griddle. Neon market signs bleeding color into the night air."

**Layer 4 (Motion):** "The roti flips rapidly with large amplitude, dough spinning in the air. His hands move quickly and surely. Steam rising explosively from the griddle."

**Layer 5 (Audio):** "Audio: sizzling oil on iron, crowd chatter in Malay and Mandarin, distant roti canai slapping sound, motorcycle passing, warm night ambiance."

---

## Grok Modes Reference
| Mode | Use for |
|---|---|
| Normal | Balanced quality, general use |
| Fun | Creative variation, unexpected results |
| Custom | Aspect ratio control + Fixed/Unfixed lens + duration |
| Speed | Rapid iteration, testing prompt variants |
| Quality (April 2026) | 4 high-quality simultaneous outputs — best for hero shots |
| Pro (upcoming) | Extended length clips |

**Grok vs Veo decision guide:**
- Choose Grok: atmospheric neon-noir, anime/Ghibli style, surreal/dream-logic, fast generation (30s vs Veo's minutes), cost ($0.20 vs $0.80–1.60), native audio, 15s max clips
- Choose Veo: 1080p resolution required, physics accuracy critical, complex multi-element dialogue scenes
`,
};
