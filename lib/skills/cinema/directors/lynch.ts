import type { Skill } from "../../types";

export const directorLynch: Skill = {
  id: "director-lynch",
  kind: "director",
  tab: "cinema",
  title: "Director: David Lynch",
  triggers: [
    "lynch",
    "david lynch",
    "twin peaks",
    "surreal",
    "dreamlike horror",
    "red velvet",
    "uncanny",
    "psychological dread",
    "blue velvet",
    "mulholland drive",
  ],
  body: `# Director: David Lynch

## Identity
David Lynch, American filmmaker, 1977–2023. The definitive surrealist of English-language cinema. His work operates on dream-logic — familiar domestic spaces distorted into dread, beauty collapsing into menace. Key works: *Blue Velvet* (1986), *Twin Peaks* (TV, 1990–2017), *Mulholland Drive* (2001), *Inland Empire* (2006).

## Visual Signature
- **Color:** Deep reds (velvet, lipstick, blood), electric blues, suburban yellows. High contrast. Colors feel saturated beyond reality.
- **Lighting:** Theatrical single-source — a lamp in darkness, a spotlight from nowhere. Shadows are motivating characters.
- **Movement:** Static wide shots that refuse to cut. Slow zooms into darkness. Sudden close-ups of mundane objects made sinister.
- **Texture:** Curtains (particularly red drapes), industrial machinery sounds, flickering fluorescents, granular analog film.
- **Audio (describe in prompts):** Angelo Badalamenti low jazz, industrial hum, backwards dialogue, sudden silence.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "surreal dreamlike distortion"
2. "uncanny suburban stillness"
3. "Twin Peaks atmospheric dread"
4. "red velvet theatrical surrealism"
5. "electric blue shadow, deep red practical light"
6. "dream-logic sequence, reality dissolving"
7. "Lynch-ian dread, beautiful and wrong"
8. "flickering single lamp, infinite darkness beyond"

## Camera Language Grok Responds To
- "slow zoom into dark doorway, red curtain at edge of frame"
- "static wide shot, subject perfectly still, deep shadow"
- "extreme close-up mundane object — made sinister by stillness"
- "dutch angle, hallway extending impossibly far"
- "slow push toward red velvet curtain, low industrial hum"

## Sample Grok Imagine Prompt
"A empty 1950s American diner at 3am. Red leather booths, black-and-white checkered floor, single fluorescent tube flickering above the counter. Through the plate glass window, darkness — nothing beyond. A cup of coffee on the counter steams. Camera: static wide, no movement, held for 8 seconds. Twin Peaks atmospheric dread. Red velvet theatrical surrealism. Uncanny suburban stillness. The coffee continues steaming. Audio: distant jazz saxophone, faint industrial hum, the tick of a clock, silence."

## Best Moods / Scenes
- Horror-adjacent fashion editorials — beauty in wrongness
- Perfume campaigns with surreal or avant-garde positioning
- Art-house brand storytelling — luxury brands wanting edge
- Music videos for dark/ambient/experimental artists
- Any content that benefits from psychological unease (thriller, mystery products)

## When NOT to Use (Anti-patterns)
- Any content requiring trust, safety, or cleanliness associations
- Food and beverage — Lynch makes familiar things disturbing
- Family or children's content
- Anything upbeat, energetic, or aspirational in a conventional sense
- Malaysian halal/modest lifestyle content — aesthetic misalignment
`,
};
