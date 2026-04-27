import type { Skill } from "../../types";

export const moodEpicFantasy: Skill = {
  id: "mood-epic-fantasy",
  kind: "mood",
  tab: "cinema",
  title: "Mood: Epic Fantasy",
  triggers: [
    "epic fantasy",
    "fantasy cinematic",
    "enchanted forest",
    "glowing sword",
    "misty mountains",
    "dragon",
    "magical landscape",
    "fantasy epic",
    "lord of the rings",
    "wuxia",
  ],
  body: `# Mood: Epic Fantasy

## Atmospheric Description
Epic Fantasy is scale made visible and magic made tangible. It is the misty valley between mountains so large they touch cloud. The enchanted forest where the light between trees has color that cannot be explained by the sun's angle. A figure standing at the edge of a cliff, looking at a world that has never existed but feels ancient and true. The magic is not special effects — it is the quality of the light, the density of the atmosphere, the size of the sky. And then, the sword begins to glow.

References: *The Lord of the Rings* (Jackson), *How to Train Your Dragon* (DreamWorks), *Princess Mononoke* (Miyazaki), *Crouching Tiger Hidden Dragon* (Ang Lee), *Legend* (Ridley Scott). For Malaysian content: wuxia aesthetics, Hang Tuah mythological tradition.

## Phrase Library (embed in Grok prompts)
1. "epic fantasy cinematic atmosphere"
2. "misty enchanted forest, ancient and magical"
3. "glowing magical artifact, soft bioluminescence"
4. "dragon soaring over mountain valley, epic scale"
5. "wuxia cinematic — warriors defying gravity, silk robes"
6. "volumetric god-rays through ancient trees"
7. "fantasy landscape: impossible scale, luminous mist"
8. "enchanted world, magic visible in the light itself"

## Camera + Lighting + Color Stack
- **Camera:** Wide establishing shots (crane, drone). Slow dolly-in for character moments. Orbital for hero reveals.
- **Lighting:** Golden hour as default. God-rays through atmosphere. Bioluminescent practicals (glowing plants, magical items). Moonlight for mystery.
- **Color palette:** Rich jewel tones. Forest greens (#1A4A2E), sky gold (#F4A460), mist silver (#C8D8E4), magic blue (#4169E1), earth brown (#8B6914).
- **Contrast:** High — the light sources are special; the shadows are deep. Magic versus mundane.
- **Atmosphere:** Mist, fog, volumetric lighting through air particles. Environments breathe.

## Best Directors That Match
- **Shinkai** (fantasy sky + magic light — perfect anime fantasy pairing)
- **Ghibli/Miyazaki** (the natural home of animated epic fantasy)
- **Villeneuve** (scale and philosophical weight for serious fantasy epics)

## Best Eras That Match
- **60s Spaghetti Western** (for grounded, earthy fantasy without digital sheen)
- **Fuji Velvia** (hyper-saturated fantasy landscape — sky and forest become extraordinary)

## Sample Full Grok Prompt
"A lone warrior in flowing crimson robes stands at the edge of a mist-filled valley, watching an ancient dragon circle the peaks of a mountain range disappearing into cloud. Epic fantasy cinematic atmosphere. Volumetric god-rays pierce the morning mist. The warrior's sword glows with a soft blue light. Camera: wide crane shot rising above the warrior, valley and dragon revealed below and beyond. Misty enchanted landscape, ancient and magical. Fuji Velvia color grade — jewel-tone greens, deep sapphire sky, golden god-rays. Audio: orchestral strings swelling, wind, distant dragon cry."
`,
};
