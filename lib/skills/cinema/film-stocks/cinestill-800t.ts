import type { Skill } from "../../types";

export const filmStockCinestill800t: Skill = {
  id: "film-stock-cinestill-800t",
  kind: "film-stock",
  tab: "cinema",
  title: "Film Stock: CineStill 800T",
  triggers: [
    "cinestill 800t",
    "cinestill",
    "tungsten film",
    "neon halation",
    "red glow film",
    "neon photography",
    "tungsten balanced",
    "night film photography",
    "red halo neon",
  ],
  body: `# Film Stock: CineStill 800T

## Identity
CineStill 800T — ISO 800 tungsten-balanced color negative film, released 2012. Derived from Kodak Vision3 5219 cinema film, modified for C-41 processing (the rem-jet backing removed). The rem-jet removal creates the stock's defining characteristic: **red halation** — a glowing red halo around bright light sources, particularly neon signs, streetlamps, and tungsten practicals. This halation, combined with the tungsten balance (which renders daylight sources blue-cool), creates the definitive neon-noir photographic aesthetic. Used extensively in night urban photography and cinematic portrait work in artificial light.

## Color Science Signature
- **Highlights (neon/tungsten):** Glow with red halation — bright sources bloom with a red halo extending 10–30px in real images
- **Shadows:** Cool blue-black, deeply saturated in deep shadow
- **Skin tones (under tungsten/neon):** Warm amber-orange — flattering under city light
- **Overall color balance:** Tungsten-balanced, so daylight sources appear very blue; tungsten/neon sources appear warm and correct
- **Grain:** Noticeable ISO 800 grain — more expressive than Portra, less than pushed 3200 stock
- **Saturation:** High in midtones; neon colors are vivid; shadow saturation drops to deep blue-black

## Phrase Library (embed in Grok prompts)
1. "CineStill 800T film stock"
2. "tungsten neon-noir, red halation around lights"
3. "red glow halo on neon signs, cool blue shadows"
4. "CineStill night photography aesthetic"
5. "neon halation bloom, tungsten-balanced night"
6. "city night film look — warm neon, cool shadow"
7. "red halation on streetlamps, CineStill grain"
8. "neon-lit portrait, red halo on light sources"

## Best Subjects
- **Urban night photography:** Neon signs, street lights, rain-reflected city scenes
- **Neon-product photography:** Product illuminated by neon in dark studio
- **Nightlife and entertainment:** Bars, clubs, concert photography
- **Fashion editorial:** Night-shoot fashion with neon/tungsten lighting
- **Portrait under practical light:** Model lit by a single tungsten lamp or neon sign

## Pairs With
- **Directors:** Ridley Scott (Blade Runner neon + CineStill = definitive pairing), Wong Kar-wai (neon bokeh becomes halation)
- **Eras:** 80s Neon Synth (CineStill makes it photographic rather than digital), 40s Noir (CineStill adds color to noir's shadow grammar)
- **Moods:** Neon Noir (the quintessential pairing — CineStill IS neon noir on film)
- **Cameras:** Dolly-in past neon sources (halation blooms as camera passes lights)

## Sample Prompt Fragment
"Shot on CineStill 800T — tungsten neon-noir, red halation blooming around every neon sign and streetlamp in frame. Cool blue shadows on the wet pavement. Her face lit warm amber by the tungsten shop window. Grain visible in the dark sky. Red glow halo on the Chinese restaurant signage above. Neon-lit night portrait."
`,
};
