import type { Skill } from "../../types";

export const directorLeone: Skill = {
  id: "director-leone",
  kind: "director",
  tab: "cinema",
  title: "Director: Sergio Leone",
  triggers: [
    "leone",
    "sergio leone",
    "spaghetti western",
    "the good the bad the ugly",
    "extreme close up",
    "dusty western",
    "ennio morricone",
    "squint standoff",
    "once upon a time in the west",
  ],
  body: `# Director: Sergio Leone

## Identity
Sergio Leone, Italian filmmaker, 1961–1984. Inventor of the Spaghetti Western — an Italian reimagining of the American frontier myth that surpassed its source material. Leone's grammar is extremes: the most extreme close-ups in cinema history (eyes only, pores visible) contrasted with the most extreme wides (tiny figures in infinite desert). Key works: *The Good, the Bad and the Ugly* (1966), *Once Upon a Time in the West* (1968), *Once Upon a Time in America* (1984).

## Visual Signature
- **Scale contrast:** Cut between extreme close-up (eyes, trigger fingers, sweat) and extreme wide (figures dwarfed by desert, architecture, landscape). Nothing in between.
- **Color:** Sun-bleached, high-contrast. Skin the color of dried earth. Skies a burning white-blue. Shadows absolute black.
- **Texture:** Dust, sweat, leather, rope. Surfaces worn. No pristine cleanliness.
- **Pacing:** Agonizingly slow build, then explosive action. The standoff can run 10 minutes before a shot is fired.
- **Framing:** Eyes fill the frame. Brim of hat cuts forehead. Hands near holsters. Desert horizon as third character.

## Prompt Phrase Library (embed verbatim in Grok prompts)
1. "Sergio Leone framing"
2. "extreme close-up eyes"
3. "dusty desert noon"
4. "Ennio Morricone tension"
5. "sun-bleached spaghetti western color grade"
6. "squinting standoff, sweat on brow"
7. "Techniscope 2.35:1, sun-burned horizon"
8. "Leone extreme close-up cut to vast wide"

## Camera Language Grok Responds To
- "extreme close-up on eyes only, dust particles in air"
- "cut to wide: two figures tiny in bleached desert, heat shimmer"
- "slow push-in on face — held, held, held — sweat visible"
- "low angle looking up at figure against burning white sky"
- "rack focus from gun hand to squinting eyes"

## Sample Grok Imagine Prompt
"Sun-bleached noon in a dusty desert canyon. A lone gunfighter stands perfectly still, hat brim low, hand near holster. Sergio Leone framing — begin with extreme close-up on his squinting eyes, sweat on brow, dust in air. Cut to wide: tiny figure in vast ochre landscape, burning white sky above, heat shimmer on the horizon. Ennio Morricone tension. Sun-bleached spaghetti western color grade. Camera: slow push-in on face, held for 5 seconds. Audio: wind, distant hawk cry, twanging electric guitar sting, heartbeat percussion."

## Best Moods / Scenes
- Premium whiskey, coffee, or tobacco brand campaigns wanting iconic masculinity
- Standoff/competition narratives — sports, business rivalry
- Western-themed fashion or leather goods
- Any "one against the world" brand narrative
- Bold, slow-burn product reveals requiring cinematic gravitas

## When NOT to Use (Anti-patterns)
- Modern urban settings — the aesthetic requires landscape and dust
- Female-led content unless deliberately subverting the genre
- Fast-paced content — Leone's rhythm demands patience; TikTok short-form breaks the standoff structure
- Warm, community-driven brand values — Leone is solitary and adversarial
- Food, beauty, or family content — wrong emotional register entirely
`,
};
