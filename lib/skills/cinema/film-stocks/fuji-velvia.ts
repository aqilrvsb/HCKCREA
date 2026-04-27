import type { Skill } from "../../types";

export const filmStockFujiVelvia: Skill = {
  id: "film-stock-fuji-velvia",
  kind: "film-stock",
  tab: "cinema",
  title: "Film Stock: Fuji Velvia (Hyper-Saturated Slide Film)",
  triggers: [
    "fuji velvia",
    "velvia",
    "hyper saturated",
    "vivid landscape",
    "punchy color",
    "slide film",
    "reversal film",
    "nature photography film",
    "saturated film look",
  ],
  body: `# Film Stock: Fuji Velvia (Hyper-Saturated Slide Film)

## Identity
Fuji Velvia 50 (and 100) — ISO 50 color reversal (slide/transparency) film, introduced 1990. The film that defined landscape and nature photography for a generation. Velvia's color saturation is approximately 1.5–2× more vivid than reality — greens become emerald, blues become sapphire, reds become crimson. Contrast is high: highlights clip quickly, shadows go very deep. Originally designed for commercial reproduction photography (the colors would hold through printing), it became the aesthetic of choice for any photographer wanting vivid, impactful images. Used in National Geographic covers, landscape advertising, and any content requiring maximum visual impact.

## Color Science Signature
- **Saturation:** Hyperchromatic — all colors pushed 50–100% beyond natural. The defining characteristic.
- **Highlights:** Clip sharply. No gentle rolloff — Velvia is unforgiving in bright light.
- **Shadows:** Deep and rich, with strong color saturation maintained even in shadow areas.
- **Greens:** Emerald, luminous, hyper-real. Foliage becomes jewel-like.
- **Blues (sky):** Deep sapphire to cobalt. Blue hour and sky shots are Velvia's crown achievement.
- **Skin tones:** Over-saturated — not Velvia's strength. Faces can go orange-red.
- **Grain:** Very fine (ISO 50) — the trade-off for the saturation is a nearly grainless image.

## Phrase Library (embed in Grok prompts)
1. "Fuji Velvia 50 color grade"
2. "hyper-saturated landscape, vivid palette"
3. "Velvia slide film aesthetic, punchy colors"
4. "emerald greens, sapphire blue sky, Velvia saturation"
5. "reversal film look, saturated and contrasty"
6. "vivid nature photography, Fuji Velvia style"
7. "jewel-tone landscape, hyper-chromatic color"
8. "punchy contrast, colors beyond real, Velvia"

## Best Subjects
- **Landscape and nature:** The primary application — mountains, forests, beaches, sky
- **Product photography in nature:** Skincare, food, outdoor gear shot in natural environments
- **Travel content:** Destination marketing where impact and memorability matter
- **Aerial and drone footage:** Sky and landscape from above become extraordinary with Velvia
- **Food photography:** Fruit, vegetables, colorful dishes — the saturation makes food sing

## Pairs With
- **Directors:** Shinkai (Velvia saturation on top of Shinkai sky = maximum sky drama), Ghibli (Velvia makes painted environments more vivid)
- **Eras:** Not compatible with dark/noir eras — Velvia needs light to sing
- **Moods:** Epic Fantasy (Velvia landscape is inherently epic), Romantic Intimate (golden hour + Velvia)
- **Cameras:** Crane shot (rising reveal of Velvia landscape), Drone FPV (aerial Velvia landscape)

## Sample Prompt Fragment
"Shot on Fuji Velvia 50 — hyper-saturated landscape, vivid palette beyond real. Emerald green rice paddies under a deep sapphire sky, puffy cumulus clouds backlit by afternoon sun. Colors punchy, contrasty, jewel-toned. No grain. The sky is electric blue. The paddies glow emerald. Velvia slide film aesthetic."
`,
};
