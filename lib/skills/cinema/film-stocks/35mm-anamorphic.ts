import type { Skill } from "../../types";

export const filmStock35mmAnamorphic: Skill = {
  id: "film-stock-35mm-anamorphic",
  kind: "film-stock",
  tab: "cinema",
  title: "Film Stock: 35mm Anamorphic (Oval Bokeh / Horizontal Flare)",
  triggers: [
    "anamorphic",
    "35mm anamorphic",
    "oval bokeh",
    "horizontal lens flare",
    "anamorphic flare",
    "widescreen anamorphic",
    "2.35 widescreen",
    "cinema lens flare",
    "scope format",
  ],
  body: `# Film Stock: 35mm Anamorphic

## Identity
Anamorphic is a lens system, not a film stock — but it defines a complete image characteristic that functions as a visual identity. Anamorphic lenses use cylindrical optical elements to squeeze a wide image onto a standard 35mm frame, then unsqueeze during projection/display to produce a 2.35:1 or 2.39:1 widescreen image. The optical mathematics of this squeeze produce distinctive artifacts that are now considered the visual signature of "cinematic quality": horizontal lens flares, oval/oval bokeh, and subtle barrel distortion. Used in virtually every major Hollywood production. References: anything Panavision, Arri Master Anamorphic, Cooke Anamorphic.

## Color Science / Optical Signature
- **Bokeh shape:** Oval/elliptical rather than circular — out-of-focus light sources form vertical ovals. Instantly recognizable as "movie quality."
- **Lens flare:** Blue horizontal streak extending across the full frame width when bright light sources enter the lens. This is the iconic "anamorphic flare."
- **Color:** No inherent color science — the anamorphic characteristic is optical, not emulsive. Pair with any film stock for color.
- **Distortion:** Slight barrel distortion, especially at wide focal lengths. Straight lines bow slightly outward.
- **Sharpness falloff:** Anamorphic lenses are characteristically less sharp at frame edges than center — considered desirable.
- **Aspect ratio:** Always 2.35:1 or 2.39:1 (scope format). Never square or 16:9.

## Phrase Library (embed in Grok prompts)
1. "35mm anamorphic lens"
2. "oval bokeh, horizontal blue lens flare"
3. "anamorphic scope 2.35:1 widescreen"
4. "Panavision anamorphic cinematic look"
5. "horizontal flare streak across frame"
6. "anamorphic oval out-of-focus highlights"
7. "cinematic scope format, anamorphic distortion"
8. "blue anamorphic flare, widescreen cinema"

## Best Subjects
- Any content wanting to read as "professional cinema" rather than "video"
- Action and drama — the format communicates serious filmmaking intent
- Landscape and architecture — the wide 2.35:1 ratio maximizes horizontal drama
- Product reveals where the anamorphic flare can sweep across the product
- Character drama — oval bokeh separates subject from background elegantly

## Pairs With
- **Directors:** Villeneuve (always anamorphic), Ridley Scott (Blade Runner anamorphic), Leone (Techniscope is near-anamorphic)
- **Film stocks:** CineStill 800T + anamorphic = neon-noir cinema perfection; Kodak Portra + anamorphic = organic cinema warmth
- **Moods:** Neon Noir, Atmospheric Dread, Epic Fantasy — all benefit from scope format
- **Cameras:** Wide tracking shot, crane reveal, dolly-in — all enhanced by scope framing

## Sample Prompt Fragment
"Shot in 35mm anamorphic scope — 2.35:1 widescreen, oval bokeh on background neon lights, horizontal blue lens flare streaking across frame as camera passes a streetlamp. Cinematic scope format. Panavision anamorphic look. Widescreen cinema aesthetic."
`,
};
