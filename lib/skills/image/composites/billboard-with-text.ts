import type { Skill } from "../../types";

export const compositeBillboardWithText: Skill = {
  id: "billboard-with-text",
  kind: "composite",
  tab: "image",
  title: "Billboard With Text — Real Text on Signage GPT-2 Only",
  triggers: [
    "billboard with text",
    "signage with text",
    "poster with text",
    "outdoor advertising",
    "product billboard",
    "text on sign",
    "real text rendering",
    "multilingual sign",
    "shopfront signage",
    "banner with text",
  ],
  body: `# Billboard With Text — Real Text on Signage GPT-2 Only

## Use Case
Generate a realistic image of a billboard, poster, shopfront sign, bus shelter ad, or any large-format signage that must display EXACT readable text — brand names, taglines, pricing, URLs, multilingual copy (BM, English, Chinese, Arabic). This is GPT-2-only territory.

## Why GPT-2 Only
- GPT-2 text rendering accuracy: **95%+ multilingual** (English, BM, Mandarin, Arabic, Tamil)
- Banana text rendering: **60-70% accuracy**, degrades significantly past 25 characters, unreliable for headline copy
- For any image where text legibility is the point, Banana is not viable — route everything here to GPT-2

## Reference Image Setup
- **Input (optional):** Product image to appear on the billboard alongside text
- **No character reference needed** — billboard composites are environment + product + text
- If brand has specific visual identity (logo, colour): describe in prompt or attach as reference with \`input_fidelity="high"\`

## Model Choice
**GPT Image 2 — mandatory for all text-on-signage work**
- 95%+ multilingual text accuracy (decisive vs Banana)
- Structured visual planning (Native Thinking Mode) handles layout logic: headline left, product right, tagline below
- Can render BM, English, and Chinese in the same frame accurately
- \`input_fidelity="high"\` preserves product from reference image on billboard face

## Full Prompt Template (GPT-2)
\`\`\`
Scene: [A roadside billboard on a Malaysian highway at golden hour / A shopfront facade in KL Bukit Bintang at night / A bus shelter poster in an urban street / A mall lightbox banner]. [Time of day and weather if relevant.]

Subject: A [horizontal / vertical] [billboard / poster / sign] displaying the product from the input image.

Important details:
  - Headline text (EXACT): "[Your headline — e.g., 'Kulit Cerah Dalam 14 Hari']"
  - Subtext (EXACT): "[Your subtext — e.g., 'Percayai lebih 50,000 pengguna']"
  - Call-to-action text (EXACT): "[e.g., 'Dapatkan Sekarang — shopee.com/brandname']"
  - Typography: [Bold sans-serif / Traditional serif / Rounded friendly] — high contrast, readable from distance
  - Layout: Product [left / right / centered], headline [opposite side / above / below], [much / moderate] white space
  - Product placement: Product occupying [30-40%] of billboard face, label readable
  - Brand colours: [describe or reference]
  - Lighting: [Golden sunset light raking across billboard face / Neon night illumination / Soft overcast day]

Use case: [Outdoor advertising mockup / Social media ad showing "billboard in the real world" / E-commerce brand awareness]

Constraints:
  - Render all text VERBATIM — no paraphrasing, no extra words, no duplicate text
  - No watermark, no stock photo watermark
  - No additional logos or brand marks not described
  - Text fully legible — no distortion, no perspective that makes text unreadable
\`\`\`

## Multilingual Billboard Pattern (BM + English + Chinese)
Add to Important details:
- "Primary headline in Bahasa Malaysia: (EXACT): '[BM text]'"
- "Secondary line in English: (EXACT): '[EN text]'"
- "Chinese subtext: (EXACT): '[中文文本]'"
- "Stack vertically: BM largest, EN medium, Chinese smallest"
- "All three scripts render correctly — verify character accuracy"

## Perspective Variations
- **Flat-on (maximum text legibility):** "Camera directly facing billboard face, no perspective angle, billboard fills frame"
- **Street-level perspective:** "Shot from street level looking up at billboard at slight angle, urban environment visible at edges"
- **Environment integration:** "Billboard in full environmental scene — highway, building facade, shopping mall atrium — billboard occupies 30-40% of frame"

## Common Failure Modes + Fixes
| Failure | Fix |
|---|---|
| Text misspelled or paraphrased | Add "render text VERBATIM — exactly as written, no changes whatsoever" + enclose each text string in quotes |
| Duplicate text appearing | Add "text appears exactly ONCE per element — no repetition, no echo" |
| BM diacritics incorrect (é, ā, etc.) | Write out diacritics explicitly and add "diacritical marks exactly as typed" |
| Arabic text reversed or broken | Add "Arabic text rendered right-to-left, correct script continuity, no character disconnection" |
| Product on billboard too small | Add "product occupies [X]% of billboard face, large and prominently visible" |
| Billboard looks fake/CGI | Add "realistic billboard material — [weathered vinyl / backlit fabric / painted wall mural], environmental wear visible" |
| Text not readable at distance | Add "high contrast text-to-background ratio, readable from viewing distance, no low-contrast text" |

## Cliffnotes
- Always use GPT-2 for text on signage — no exceptions
- Enclose every text string in quotes in the prompt
- Specify "render verbatim" for each text element
- Describe font weight and contrast explicitly
- For multilingual: list each language separately with its exact text
`,
};
