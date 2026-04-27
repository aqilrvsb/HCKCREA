import type { Skill } from "../../types";

export const era90sVhs: Skill = {
  id: "era-90s-vhs",
  kind: "era",
  tab: "cinema",
  title: "Era: 90s VHS / Lo-Fi Camcorder",
  triggers: [
    "vhs",
    "90s aesthetic",
    "lo fi video",
    "camcorder",
    "analog tape",
    "vhs grain",
    "tape distortion",
    "retro video",
    "90s nostalgia",
    "home video look",
  ],
  body: `# Era: 90s VHS / Lo-Fi Camcorder

## Visual Identity (1985–2001)
The consumer camcorder era — Sony Handycam, Panasonic PalmCorder, JVC GR series. Tape-based recording introduced a distinctive image degradation that is now aesthetically loaded: warm color bleeding, horizontal scan line artifacts, chroma smearing, and the particular way VHS resolves faces into soft, rounded forms. References: *The Blair Witch Project* (1999), *Cloverfield* (2008), early YouTube aesthetic, 90s family home video.

## Phrase Library (embed in Grok prompts)
1. "VHS tape aesthetic, analog grain"
2. "lo-fi camcorder footage, 90s home video"
3. "chroma bleeding, scan line artifacts"
4. "VHS tracking error, tape distortion"
5. "soft resolution, warm color bleed, 90s camcorder"
6. "consumer camcorder grain, shoulder-mounted aesthetic"
7. "found footage VHS texture, authentic tape degradation"
8. "analog tape noise, warm oversaturated VHS color"

## Lighting / Color / Grain
- **Color:** Warm, oversaturated, with particular emphasis on red and orange skin tones. Blues go cyan. Shadows are muddy rather than deep.
- **Grain/texture:** Luminance noise in shadows, chroma noise in highlights. Not film grain — video noise: brighter, more uniform, less organic.
- **Artifacts:** Horizontal scan lines at frame edges, occasional tracking error (white horizontal tear), color fringing on high-contrast edges.
- **Sharpness:** Soft. Faces resolve without sharp edges. Text appears slightly blurry.
- **Frame rate:** 30fps NTSC feel — slightly too smooth compared to 24fps film.

## Best Products / Scenes for VHS Styling
- Nostalgia-driven lifestyle brands targeting millennials (born 1985–1995)
- "Authentic" or "raw" brand positioning — anti-luxury signaling
- Music content: indie, lo-fi hip hop, 90s revival genres
- Food/beverage with a "homemade" or "grandma's recipe" narrative
- Gaming brands evoking early-console era
- Fashion editorial with deliberate "thrift store" or "vintage" positioning

## When NOT to Use (Became Dated)
- Any brand requiring premium, precision, or luxury perception — VHS signals cheap
- Technical/professional products (software, medical, finance) — lo-fi undermines credibility
- Skincare/beauty products promising clarity or high-performance results — grain contradicts the promise
- B2B content of any kind

## Sample Prompt
"A group of teenagers at a 1995 backyard barbecue, shot on consumer camcorder, VHS tape aesthetic, analog grain, warm chroma bleeding. Scan line artifacts at frame edges. Soft resolution. The handheld camera pans across picnic tables, food, laughter. Lo-fi 90s home video texture. Color: warm orange skin tones, oversaturated green grass, VHS-characteristic cyan sky. Audio: ambient party noise, wind on the microphone, distant radio playing 90s pop."
`,
};
