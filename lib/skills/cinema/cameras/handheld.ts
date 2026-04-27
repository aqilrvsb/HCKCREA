import type { Skill } from "../../types";

export const cameraHandheld: Skill = {
  id: "camera-handheld",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Handheld",
  triggers: [
    "handheld",
    "documentary style",
    "organic shake",
    "realistic camera",
    "found footage feel",
    "news camera",
    "urgency camera",
    "guerrilla filming",
    "verite",
  ],
  body: `# Camera Move: Handheld

## What It Does Physically
The operator physically carries the camera without stabilization. This introduces organic micro-movements — slight wobble, breathing rhythm, reactive reframing. The result reads as immediate, present, and real. The camera becomes a witness rather than a God's eye.

## Grok Phrase Variations
1. "handheld camera, organic shake"
2. "documentary-style handheld footage"
3. "shaky cam, urgent and reactive"
4. "guerrilla handheld, rough and immediate"
5. "found-footage handheld aesthetic"
6. "news camera realism, handheld wobble"
7. "cinema verité handheld, natural movement"
8. "operator breathing, slight camera drift"

## Success Rate
**75% — reliable when shake intensity is specified.** Grok can go too smooth (gimbal-like) if "handheld" alone is specified. Add shake intensity descriptors to anchor the correct level.

**Shake calibration:**
- "slight organic drift" — barely perceptible, near-gimbal
- "natural handheld shake" — realistic operator movement
- "aggressive handheld, urgent shake" — action/crisis energy
- "extreme shaky cam" — chaos, disorientation, found-footage

## When to Use
- **UGC-style content:** products shown in "real life" context benefit from handheld authenticity
- **Action sequences:** chase, fight, escape — handheld adds adrenaline
- **Interview/talking head:** documentary authenticity
- **Street scenes:** markets, crowds, urban chaos — handheld matches the energy
- **Crisis or urgency narrative:** disaster, conflict, time pressure

## When NOT to Use (Anti-patterns)
- Luxury product reveals — shake undermines premium perception
- Architectural or landscape beauty shots — stability shows control and scale
- Slow romantic moments — handheld reads as anxiety, not tenderness
- When text overlays or lower thirds are planned — shake makes text harder to read

## Pairs With
- **Directors:** Lynch (uncanny + handheld = deeply unsettling), Wong Kar-wai (handheld intimacy)
- **Eras:** 70s Cinema Verité, 90s VHS
- **Moods:** Atmospheric Dread (creeping handheld), Surreal Dream (disoriented handheld)

## Sample Prompt Fragment
"Camera: handheld, natural operator shake, camera drifting slightly as it follows the subject through the crowded market. Reactive reframing — occasionally losing and reacquiring focus. Documentary authenticity. Cinema verité style."
`,
};
