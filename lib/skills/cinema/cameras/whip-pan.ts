import type { Skill } from "../../types";

export const cameraWhipPan: Skill = {
  id: "camera-whip-pan",
  kind: "camera",
  tab: "cinema",
  title: "Camera Move: Whip Pan (Smash Pan / Flash Pan)",
  triggers: [
    "whip pan",
    "smash pan",
    "flash pan",
    "rapid pan transition",
    "frenetic cut",
    "speed pan",
    "blur transition",
    "hyper pan",
  ],
  body: `# Camera Move: Whip Pan (Smash Pan / Flash Pan)

## What It Does Physically
An extremely fast horizontal rotation of the camera — so fast that the intervening frames are pure motion blur. Used as a transition technique: whip out of one scene, whip into the next. Creates a feeling of frenetic energy, rapid time passing, or comedic/dramatic scene changes. Edgar Wright elevated this to an art form; Guy Ritchie uses it for kinetic style.

## Grok Phrase Variations
1. "whip pan transition, motion blur smear"
2. "smash pan — rapid camera rotation, all blur between scenes"
3. "flash pan cut, camera swipes left/right violently"
4. "hyper-fast pan, frame dissolves into horizontal blur"
5. "camera whips right, smearing into next scene"
6. "transition: whip pan blur, next shot emerges from motion"
7. "speed-ramped pan, from slow to instant"
8. "Guy Ritchie whip pan style, kinetic scene change"

## Success Rate
**50–60% — variable.** Grok can produce whip pan smear but may interpret it as a cut rather than a single continuous motion. **Critical:** specify this as a within-shot move ("camera whips right within the same shot, background blurring") not a transition between shots, to avoid Grok treating it as an edit cut.

**Note on pan speed:** Regular pans above 40% speed produce smearing in Grok (undesirable for clean pans). Whip pan intentionally weaponizes this smear — so maximum speed is desired here.

## When to Use
- **Scene transitions within a video:** whip from location A to location B
- **Comedy beats:** visual punctuation for a punchline or reaction
- **Action montages:** rapid whip pans between action beats create kinetic rhythm
- **Music video cuts:** synced to beat drops
- **Time-passing sequences:** multiple whip pans suggest rapid time passage

## When NOT to Use (Anti-patterns)
- Slow, emotional, or atmospheric content — whip pan annihilates contemplative mood
- Single-subject product reveals — whip pan distracts from the product
- Content where spatial orientation matters — viewer loses sense of where they are
- Epilepsy-sensitive content — fast flicker/blur may be problematic for accessibility

## Pairs With
- **Cameras:** Combine tracking shot + whip pan for action sequence momentum
- **Technique:** Hyper Motion adverbs to ensure actual speed ("camera whips violently to the right")
- **Moods:** Not compatible with atmospheric/dread moods; best for action/comedy/kinetic
- **Eras:** 90s VHS (lo-fi whip pan), 80s Neon Synth (stylized transition)

## Sample Prompt Fragment
"Camera whips violently to the right — frame smears into pure horizontal motion blur — then slams into the next scene: a crowded neon market at night. Whip pan transition. Motion blur between scenes is complete. Frenetic, kinetic energy."
`,
};
