import type { Skill } from "../../types";

export const moodNeonNoir: Skill = {
  id: "mood-neon-noir",
  kind: "mood",
  tab: "cinema",
  title: "Mood: Neon Noir",
  triggers: [
    "neon noir",
    "cyberpunk",
    "rain soaked city",
    "neon reflections",
    "blade runner mood",
    "dark city",
    "urban noir",
    "night city rain",
    "dystopian night",
    "neon wet street",
  ],
  body: `# Mood: Neon Noir

## Atmospheric Description
Neon Noir is rain-slicked asphalt reflecting electric signs that glow in colors that have no place in nature — cyan, magenta, acid-green. It is 2am in a city that never asked to be beautiful and became beautiful anyway. Steam rises from street grates. A lone figure walks away from camera. The air is thick with moisture and industrial exhaust. Everything is too bright in the neon zones and absolute black in the shadows between. This mood lives in the tension between control (the geometric city grid) and dissolution (the rain, the fog, the blur).

**Grok strength:** Neon Noir is one of Grok Imagine's most reliably strong outputs. The model generates atmospheric rain-and-neon scenes with high consistency at ~80% quality rate. This is a recommended mood for Grok-first prompting.

## Phrase Library (embed in Grok prompts)
1. "rain-slicked neon streets, reflections in wet asphalt"
2. "neon-lit urban noir, cyberpunk atmosphere"
3. "Blade Runner 2049 color grade"
4. "steam from grates, lone figure in rain"
5. "neon signs reflecting in puddles — cyan and magenta"
6. "low-key lighting, hard neon shadows"
7. "atmospheric urban night, rain misting the air"
8. "electric signs bleeding color into wet concrete"

## Camera + Lighting + Color Stack
- **Camera:** Low angle (street level), wide to medium. Dolly-in for intimacy. Tracking alongside figures.
- **Lighting:** All practical neon sources — signs, windows, distant headlights. No studio fill. Searchlights through fog.
- **Color palette:** Cyan #00FFFF, magenta #FF00FF, amber #FFB347, deep blue-black #080C14. Rain makes every color multiply.
- **Depth of field:** Shallow — one neon bokeh background, one sharp subject.
- **Motion:** Slow. Grok defaults to slow motion in atmospheric scenes — this works for Neon Noir.

## Best Directors That Match
- **Ridley Scott** (Blade Runner atmosphere — primary match)
- **Wong Kar-wai** (urban loneliness + neon — secondary match for romance-inflected noir)
- **Denis Villeneuve** (Blade Runner 2049 sequel energy, atmospheric scale)

## Best Eras That Match
- **80s Neon Synth** (retrowave neon = foundational Neon Noir)
- **40s Noir** (structural shadow grammar updated to neon color)
- **CineStill 800T** (the photographic Neon Noir stock — halation is native to this mood)

## Sample Full Grok Prompt
"Futuristic Tokyo street at 2am, rain-slicked asphalt, neon reflections, low-angle wide shot, cinematic fog, Blade Runner mood. A lone figure in a reflective raincoat walking away from camera, wet pavement reflecting purple and cyan lights from neon signs above. Steam rising from a sidewalk grate. Camera: slow tracking shot at street level. Shot on CineStill 800T — red halation blooming around every light source. Anamorphic scope 2.35:1. Audio: rain on pavement, distant sirens, low synthesizer drone, neon electrical hum."
`,
};
