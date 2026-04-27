import type { Skill } from "../../types";

export const directorGhibli: Skill = {
  id: "director-ghibli",
  kind: "director",
  tab: "cinema",
  title: "Director: Studio Ghibli / Miyazaki",
  triggers: [
    "ghibli",
    "miyazaki",
    "studio ghibli",
    "spirited away",
    "totoro",
    "watercolor anime",
    "whimsical",
    "hand drawn",
    "childlike wonder",
    "howls moving castle",
  ],
  body: `# Director: Studio Ghibli / Hayao Miyazaki

## Identity
Hayao Miyazaki and Studio Ghibli, Japan, 1985–present. The gold standard of hand-crafted animation — films that feel painted into existence. Ghibli's aesthetic is defined by organic warmth, environmental reverence, and the collision of mundane domesticity with magic. Key works: *My Neighbor Totoro* (1988), *Spirited Away* (2001), *Howl's Moving Castle* (2004), *Princess Mononoke* (1997).

## Visual Signature
- **Color:** Warm, soft, never harsh. Greens are sage and moss. Skies are painted watercolor blue with hand-drawn cumulus. Food glows with warmth. Fire is orange joy, not danger.
- **Texture:** Visible brushstroke texture in backgrounds. Watercolor washes over linework. Characters cel-shaded with clean outlines against painterly environments.
- **Movement:** Characters move with weight — no floaty anime physics. Wind moves hair and fabric constantly. Every background element reacts to environment.
- **Environment:** Lush, abundant nature — grass sways, leaves turn, water ripples. Architecture is warm European-Asian fusion: stone baths, wooden beams, tiled roofs.
- **Atmosphere:** Sunlight through leaves dappled. Dust motes visible in shafts of light. Rain as cozy, not gloomy.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "Studio Ghibli aesthetic"
2. "Miyazaki color palette"
3. "hand-drawn watercolor texture"
4. "childlike wonder"
5. "whimsical atmosphere"
6. "Spirited Away magical realism"
7. "lush organic environment, sage greens, painted sky"
8. "Ghibli warmth, cozy domestic magic"

## Camera Language Grok Responds To
- "wide establishing pan across lush countryside, Ghibli color palette"
- "low angle looking up at towering ancient tree, sunlight filtering through"
- "slow tilt down from painted sky to cozy cottage in valley"
- "tracking shot through forest, dappled light, Miyazaki aesthetic"
- "overhead wide shot, character tiny in vast nature, hand-drawn texture"

## Sample Grok Imagine Prompt
"A young girl in a summer dress runs through a sunlit meadow toward an enormous ancient camphor tree, Studio Ghibli aesthetic, Miyazaki color palette — sage greens, warm yellows, painted watercolor sky. Hand-drawn watercolor texture in the grass and leaves. Childlike wonder. Soft afternoon light filters through branches, casting dappled shadows. Camera: wide tracking shot following her run, then slow tilt up to reveal the full canopy. Whimsical atmosphere. Audio: wind through tall grass, distant cicadas, light orchestral piano."

## Best Moods / Scenes
- Children's products, education, family brands
- Organic/natural food and beverage — the environmental reverence transfers
- Travel and eco-tourism — nature as sacred space
- Seasonal Hari Raya or CNY campaigns wanting warmth and wonder
- Any brand with wholesome, family-forward positioning

## When NOT to Use (Anti-patterns)
- Luxury or premium-adult positioning — Ghibli reads young and accessible
- Dark, edgy, or provocative brand messaging
- Urban-cool or streetwear aesthetics — too rural and pastoral
- Corporate B2B content
- Anything requiring photorealism — Ghibli's charm is the hand-drawn departure from reality
`,
};
