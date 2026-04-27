import type { Skill } from "../../types";

export const directorVilleneuve: Skill = {
  id: "director-villeneuve",
  kind: "director",
  tab: "cinema",
  title: "Director: Denis Villeneuve",
  triggers: [
    "villeneuve",
    "arrival",
    "dune",
    "blade runner 2049",
    "monolithic scale",
    "sci fi cinematic",
    "cold epic",
    "philosophical cinema",
    "sparse vast",
  ],
  body: `# Director: Denis Villeneuve

## Identity
Denis Villeneuve, Québécois filmmaker, 2009–present. Master of monolithic scale and philosophical weight. His cinema makes humanity feel both precious and infinitesimal against vast, indifferent forces. Key works: *Arrival* (2016), *Blade Runner 2049* (2017), *Dune* (2021/2024).

## Visual Signature
- **Scale:** Subjects dwarfed by architecture, landscape, or alien geometry. Negative space is compositional data.
- **Color:** Cold desaturated palettes — grey-blue (*Arrival*), amber ochre (*Dune*), orange smog (*Blade Runner 2049*). Rarely warm without purpose.
- **Lighting:** Motivated light sources, extreme directional beams through atmospheric haze. God-rays through dust and fog.
- **Movement:** Slow, deliberate — mostly locked-off or barely drifting. Crane reveals used sparingly but devastatingly.
- **Sound design (describe in prompts):** Silence before impact; low sub-bass drone; Jóhann Jóhannsson / Hans Zimmer orchestral swell.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "Arrival monolithic scale"
2. "Dune desert epic"
3. "sparse dialogue, vast negative space"
4. "philosophical cinematic weight"
5. "cold desaturated atmosphere, god-rays through haze"
6. "human figure dwarfed by alien architecture"
7. "Denis Villeneuve aesthetic, Blade Runner 2049 color grade"
8. "orange ochre dust, desolate grandeur"

## Camera Language Grok Responds To
- "wide locked-off shot, figure tiny against massive structure"
- "slow crane down onto lone subject in vast landscape"
- "god-rays piercing dust haze, subject silhouetted below"
- "extreme wide angle, cold blue atmosphere, deep focus"
- "slow dolly-in from distance, building dread"

## Sample Grok Imagine Prompt
"A lone astronaut stands at the foot of an impossibly tall black monolith rising from a sand-covered desert floor, Arrival monolithic scale, cold desaturated atmosphere, god-rays piercing amber dust haze. Sparse, vast negative space above and around the figure. Camera: wide locked-off shot, human figure tiny against massive alien structure. Philosophical cinematic weight. Denis Villeneuve aesthetic. No dialogue, only the low drone of distant atmosphere. Cinematic 2.35:1. Audio: sub-bass drone, wind across sand, silence."

## Best Moods / Scenes
- Brand launches requiring gravitas and scale (automotive, tech, luxury)
- Sci-fi product reveals — space, future, AI themes
- Architecture and real estate — epic scale of space
- Perfume with existential or philosophical positioning
- Any "lone hero" narrative: entrepreneur, pioneer, athlete

## When NOT to Use (Anti-patterns)
- Warm, playful, or community-driven content — Villeneuve is cold and solitary
- Food, beauty, or lifestyle — human warmth is absent from this aesthetic
- Fast-cut content — his rhythm demands patience; short clips break the spell
- Anything requiring multiple characters interacting — he frames isolation
- Comedy — the weight and solemnity collapse any levity
`,
};
