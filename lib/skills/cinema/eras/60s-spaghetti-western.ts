import type { Skill } from "../../types";

export const era60sSpaghettiWestern: Skill = {
  id: "era-60s-spaghetti-western",
  kind: "era",
  tab: "cinema",
  title: "Era: 60s Spaghetti Western (Techniscope / Eastman Color)",
  triggers: [
    "spaghetti western",
    "60s western",
    "techniscope",
    "eastman color",
    "sun bleached western",
    "leone era",
    "frontier western",
    "western film look",
    "dusty frontier",
  ],
  body: `# Era: 60s Spaghetti Western (Techniscope / Eastman Color)

## Visual Identity (1960–1975)
Italian-produced westerns shot in the deserts of Almería, Spain — standing in for the American Southwest. Shot on Techniscope (2-perf 35mm) giving a distinctively gritty, grainy widescreen image with real photographic imperfections. Eastman Color stock of the era produced sun-bleached, high-contrast images with particular characteristics: warm skin tones, bleached skies, deep brown shadows. References: *A Fistful of Dollars* (1964), *The Good, the Bad and the Ugly* (1966), *Once Upon a Time in the West* (1968), *Django* (1966).

## Phrase Library (embed in Grok prompts)
1. "sun-bleached Spaghetti Western color grade"
2. "Techniscope 2.35:1, Eastman Color film stock"
3. "Italian Western aesthetic, dusty frontier"
4. "Leone-era cinematography, high contrast desert"
5. "bleached ochre landscape, deep brown shadows"
6. "Sergio Leone visual style, 60s western"
7. "Almería desert sun, film-grain realism"
8. "Ennio Morricone visual rhythm, slow tension build"

## Lighting / Color / Grain
- **Color:** Bleached yellows and ochre. Skin tones warm amber. Sky often over-exposed to near-white. Shadows absolute brown-black.
- **Grain:** Visible, organic 35mm grain — more present than Hollywood productions of the same era due to cheaper stock.
- **Contrast:** Very high. Highlights clip. Shadow detail minimal. The sun is an adversary.
- **Sharpness:** Moderately soft with characteristic Techniscope focus falloff at frame edges.
- **Lens characteristics:** Slight optical distortion at wide angles. Chromatic aberration on high-contrast edges.

## Best Products / Scenes
- Whiskey, bourbon, mezcal — frontier authenticity
- Leather goods, boots, heritage fashion
- Coffee brands with "rugged" or "bold" positioning
- Automotive (trucks, off-road) — frontier capability
- Mens grooming brands with heritage narrative
- Any "earned, not given" brand narrative

## When NOT to Use
- Female-led content (unless deliberately subverting the all-male genre)
- Urban, modern, or tech products — temporal mismatch
- Any product requiring cleanliness or precision associations
- Youth-oriented brands — the aesthetic reads heritage/aged

## Sample Prompt
"A lone rider on horseback crests a sun-bleached ridge in a vast desert canyon, Spaghetti Western color grade — Eastman Color, high contrast, ochre landscape, sky bleached near-white by noon sun. Techniscope 2.35:1 widescreen. 35mm film grain visible. Camera: extreme wide shot, rider tiny against the massive canyon walls. Then: cut to extreme close-up on squinting eyes, sweat on brow, hat brim low. Sergio Leone visual style. Audio: Ennio Morricone whistle motif, wind, horse breathing."
`,
};
