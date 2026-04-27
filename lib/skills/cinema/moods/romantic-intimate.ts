import type { Skill } from "../../types";

export const moodRomanticIntimate: Skill = {
  id: "mood-romantic-intimate",
  kind: "mood",
  tab: "cinema",
  title: "Mood: Romantic Intimate",
  triggers: [
    "romantic",
    "intimate",
    "golden hour romance",
    "rooftop sunset",
    "love scene",
    "warm romance",
    "intimate moment",
    "couple cinematic",
    "soft romance",
    "tender moment",
  ],
  body: `# Mood: Romantic Intimate

## Atmospheric Description
Romantic Intimate is the golden hour on a rooftop when the city below is still and the light is the exact temperature of safety. It is two people in shallow focus, the world behind them dissolved into warm bokeh circles that could be city lights or stars. The camera is close enough to see the texture of a face. The depth of field is shallow enough that only one eye is in perfect focus. Time has slowed. There is no urgency. The only thing that matters is this — the quality of this light, the warmth on this face, this moment held gently before it becomes memory.

References: *Before Sunrise* (Linklater), *Lost in Translation* (Sofia Coppola), *La La Land* (Damien Chazelle), *Eternal Sunshine of the Spotless Mind* (Gondry), WKW's entire catalogue.

## Phrase Library (embed in Grok prompts)
1. "golden hour warm light, shallow depth of field"
2. "romantic bokeh, city lights dissolving behind"
3. "intimate close-up, one eye in focus, tender expression"
4. "soft warm cinematic — rooftop dusk, magic hour"
5. "shallow focus romance, background bokeh circles"
6. "warm backlight haloing hair, face in golden shadow"
7. "quiet intimate moment, camera held still"
8. "Kodak Portra warm skin tones, romantic atmosphere"

## Camera + Lighting + Color Stack
- **Camera:** Slow dolly-in for approaching intimacy. Static for held moments. Slight handheld drift — human, breathing. Never fast.
- **Lighting:** Golden hour practical — sun at 15° above horizon, warm amber light wrapping subject. Backlight for hair halo. No hard shadows.
- **Color palette:** Amber (#FFB347), peach (#FFCBA4), warm white (#FFF8F0), dusky rose (#C19A8A), soft gold (#F4D06F). Everything warm. Nothing cool.
- **Depth of field:** Extremely shallow. f/1.4 equivalent. Background is pure abstract bokeh.
- **Film stock:** Kodak Portra 400 — natural pairing. Skin tones warm and creamy. Grain organic and soft.

## Best Directors That Match
- **Wong Kar-wai** (the definitive romantic intimate director — slow-motion yearning)
- **Shinkai** (youth romance + emotional sky + warm backlight)
- **Ghibli** (for softer, more innocent romantic intimacy)

## Best Eras That Match
- **Kodak Portra 400** (the film stock of romantic portrait photography)
- **70s Cinema Verité** (available light creates unposed intimacy)

## Sample Full Grok Prompt
"A young woman sits on a rooftop garden at dusk in Kuala Lumpur, the city lights beginning to glow below as the sky transitions from amber to deep blue. Romantic intimate mood. Camera: slow dolly-in toward her face, stopping in extreme close-up — one eye sharp, the other side of her face softly out of focus. Warm golden hour light on her cheek. Background city lights dissolved into warm bokeh circles. Shot on Kodak Portra 400 — creamy warm skin tones, cyan shadow in her hair. Shallow depth of field romance. Audio: soft ambient city hum, distant music from below, gentle wind."
`,
};
