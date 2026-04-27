import type { Skill } from "../../types";

export const moodAtmosphericDread: Skill = {
  id: "mood-atmospheric-dread",
  kind: "mood",
  tab: "cinema",
  title: "Mood: Atmospheric Dread",
  triggers: [
    "atmospheric dread",
    "horror mood",
    "psychological tension",
    "slow burn horror",
    "dread",
    "unsettling",
    "creeping fear",
    "slow horror",
    "psychological horror",
    "ambient threat",
  ],
  body: `# Mood: Atmospheric Dread

## Atmospheric Description
Atmospheric Dread is the feeling before the thing happens. It is a room that is wrong in a way you cannot name. A hallway that extends slightly too far. A sound that might be wind. It is not jump scares — it is the slow accumulation of wrongness, built frame by frame through light that comes from the wrong direction, color that is just slightly off, and silence that has texture. The viewer cannot leave the discomfort because nothing has yet happened to justify the feeling. That is the mood.

References: *Midsommar* (Ari Aster), *Hereditary* (Ari Aster), *The Witch* (Robert Eggers), Lynch's body of work, *Annihilation* (Garland). In Grok: the atmospheric density and slow motion default actually support this mood well.

## Phrase Library (embed in Grok prompts)
1. "atmospheric dread, slow-burn psychological tension"
2. "uncanny stillness, something is wrong"
3. "low-key horror atmosphere, dread building"
4. "oppressive negative space, ambient threat"
5. "static composition held too long, wrong feeling"
6. "unsettling color — slightly off, not quite real"
7. "slow creeping camera, approaching the unknown"
8. "silence that has texture, dread without source"

## Camera + Lighting + Color Stack
- **Camera:** Static wide shots held longer than comfortable. Very slow dolly-in. Handheld only for crisis moments — dread is static.
- **Lighting:** Practical sources only — a candle, a lamp far away, daylight through clouds that doesn't warm. Motivated light that feels wrong.
- **Color palette:** Desaturated. Sickly green-grey (#8B9467), pale yellow (#D4C89A), cold blue-white (#BFCCD6). Colors that suggest illness or absence of life.
- **Contrast:** Low contrast in general — but with occasional pools of hard shadow. Nothing is bright.
- **Temperature:** Cool. Never warm. Warmth = safety; dread = cold.

## Best Directors That Match
- **Lynch** (primary — uncanny dread is his native language)
- **Villeneuve** (Arrival atmospheric wrongness, Annihilation-adjacent)
- **Ridley Scott** (Alien atmospheric dread in sci-fi context)

## Best Eras That Match
- **40s Noir** (shadow grammar + dread = gothic horror territory)
- **70s Cinema Verité** (available-light realism makes dread feel real rather than theatrical)

## Sample Full Grok Prompt
"An empty school corridor at 3am, fluorescent lights flickering at the far end. Atmospheric dread. Static wide shot — the hallway extends too far, perspective slightly wrong. Sickly green-grey color cast from the fluorescents. One door at the end is ajar. No movement. Camera: completely still, held for 8 seconds. Then: very slow dolly-in — barely perceptible. The door does not open further. Uncanny stillness, something is wrong. Low-key horror atmosphere. Audio: fluorescent hum, distant water drip, clock ticking from somewhere, silence between sounds."
`,
};
