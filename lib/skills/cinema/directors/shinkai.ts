import type { Skill } from "../../types";

export const directorShinkai: Skill = {
  id: "director-shinkai",
  kind: "director",
  tab: "cinema",
  title: "Director: Makoto Shinkai",
  triggers: [
    "shinkai",
    "makoto shinkai",
    "your name",
    "weathering with you",
    "anime cinematic",
    "volumetric flare",
    "dramatic sky anime",
    "anime realism",
    "5 centimeters",
  ],
  body: `# Director: Makoto Shinkai

## Identity
Makoto Shinkai (新海誠), Japanese animation director, 1998–present. The "next Miyazaki" who transcended the label. His films achieve photographic realism within anime, making backgrounds indistinguishable from photographs while characters carry emotional weight through light rather than expression. Key works: *5 Centimeters Per Second* (2007), *Your Name* (2016), *Weathering with You* (2019).

## Visual Signature
- **Sky:** Shinkai skies are the protagonist. Dramatic cumulus, sun breaking through storm clouds, light shafts, rainbow prisms. Hyper-detailed cloud formations with luminous God-rays.
- **Light:** Volumetric lens flares that bloom at frame edges. Sun positioned just off-center to create maximum flare. Every reflective surface — puddles, windows, glasses — captures exact light.
- **Color:** Saturated but not harsh. Clear blues, warm golds, fresh greens. Cityscapes at magic hour with every window lit individually.
- **Detail:** Urban backgrounds with impossible specificity — individual leaves, rain droplets on glass, power lines crossing sky.
- **Emotion:** Light does the emotional work. Characters backlit at peak emotional moments. Rain as intimacy catalyst.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "Makoto Shinkai style"
2. "volumetric lens flare"
3. "detailed urban reflections"
4. "dramatic emotional sky"
5. "anime realism, photographic background detail"
6. "God-rays through cumulus storm clouds"
7. "rain on window glass, warm backlit interior"
8. "Your Name aesthetic, magic hour sky drama"

## Camera Language Grok Responds To
- "wide shot looking up at dramatic sky, character silhouette below"
- "slow tilt up from rain-slicked street to breaking storm clouds"
- "volumetric lens flare bloom as camera pans through sunlight"
- "close-up rain droplets on glass, out-of-focus cityscape behind"
- "wide urban establishing shot, every window individually lit, magic hour"

## Sample Grok Imagine Prompt
"Anime boy and girl running through a snowy city park, snowflakes falling, girl in pink ear muffs and puffer coat, boy in sherpa coat and scarf, both laughing, bare trees with warm backlight, Makoto Shinkai style. Volumetric lens flare blooming from low winter sun behind the trees. Detailed urban reflections on wet park path. Dramatic emotional sky — pale blue with gold cloud edges. Camera: wide tracking shot following them laterally, trees strobing the sunlight. Audio: wind, laughter, light piano melody."

## Best Moods / Scenes
- Youth, romance, nostalgia — especially for fashion and lifestyle brands
- Seasonal campaigns (monsoon, Hari Raya, CNY) — weather as emotion
- Skincare/beauty — fresh, clean, luminous associations
- Travel and tourism — sky and landscape as destination promise
- Any brand wanting anime-credibility with mainstream visual quality

## When NOT to Use (Anti-patterns)
- Dark, moody, or horror-adjacent content — incompatible with Shinkai's luminosity
- Adult/mature themes — his aesthetic is fundamentally youthful
- Corporate or B2B content — too whimsical for serious enterprise positioning
- Gritty or realistic documentary style — opposite aesthetic register
- Content where anime style may confuse brand identity for non-anime brands
`,
};
