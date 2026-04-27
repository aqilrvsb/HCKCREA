import type { Skill } from "../../types";

export const photographerAnnieLeibovitz: Skill = {
  id: "annie-leibovitz",
  kind: "photographer",
  tab: "image",
  title: "Annie Leibovitz — Intimate Environmental Portraiture",
  triggers: [
    "annie leibovitz",
    "leibovitz",
    "psychological portrait",
    "environmental portrait",
    "deeply lit",
    "intimate portrait",
    "narrative portrait",
    "celebrity editorial",
    "character study",
    "soulful portrait",
  ],
  body: `# Annie Leibovitz — Intimate Environmental Portraiture

## Photographer Identity
Annie Leibovitz shoots people as if the camera is the last witness before a secret is revealed. Her images feel lived-in: the subject's environment bleeds meaning into them, and lighting sculpts psychological weight rather than just illuminating faces. Every image implies a story that started before the frame and will continue after.

## Visual Signature
- **Lighting:** Dramatic, directional — often a single deep source (window, practical lamp, or off-axis softbox). Long shadows. Skin rendered in warm amber or cool blue depending on emotional register.
- **Composition:** Subject placed in tension with their environment — never perfectly centered, always in dialogue with the space.
- **Colour:** Rich, painterly. Deep shadows hold colour. Highlights are controlled, never blown.
- **Subjects:** Celebrities, cultural figures, models — always with personality layered in. Clothing and props are narrative tools.

## Prompt Phrase Library
1. "Annie Leibovitz-style intimate environmental portrait, directional window light, deep shadow fill, painterly colour grade"
2. "psychological depth portrait, subject embedded in meaningful environment, Leibovitz chiaroscuro lighting"
3. "narrative editorial portrait, single-source dramatic light, rich shadow, warm amber highlights, medium-format feel"
4. "environmental character study, subject and setting in visual dialogue, cinematic depth of field"
5. "Vanity Fair portrait style, deeply lit, emotionally weighted, subject mid-action, candid-feeling but composed"
6. "large-format editorial, soulful gaze, practical light source visible, warm tones, shallow focus background"
7. "celebrity documentary portrait, natural setting transformed by light, story implied in posture and props"

## Best Model
**Banana Pro** — Leibovitz's atmospheric depth, environmental complexity, and warm-toned chiaroscuro are precisely what Banana's photoreal rendering excels at. Its native multimodal understanding handles multi-element scenes (subject + environment + lighting) without flattening depth. GPT-2's instruction-following strength is wasted here; it over-cleans skin and flattens shadow detail.

## Subject Types
- **Portrait:** Primary domain — celebrities, personalities, figures with narrative weight
- **Fashion/Editorial:** When fashion is secondary to character; clothing as costume not product
- **Lifestyle:** When the lifestyle scene needs psychological gravitas
- **Not ideal for:** Pure product close-ups, flat-lay, or brand-clean commercial work

## Sample Full Prompt (Banana)
"A striking Malaysian woman in her 40s seated at a worn wooden desk in a dimly lit home studio, surrounded by stacked books, paint-stained palettes, and framed photographs on the wall. She looks directly into the camera with calm authority, one hand resting on an open journal. Single-source window light from frame-left, warm amber casting long shadows across her face and the desk surface. Medium-full shot, slightly off-center composition. Annie Leibovitz-style intimate environmental portrait, painterly colour grade, 85mm lens depth of field, soft bokeh on background clutter, rich shadow detail in fabrics and wood grain."

## Counter-Prompt Warnings
- **If Banana over-brightens the shadow fill:** Add "deep shadow fill, no fill light, chiaroscuro contrast" — Banana's default bias toward even exposure fights Leibovitz's darkness.
- **If environment loses detail:** Add "sharp environmental texture, background in soft focus but not blurred to abstraction."
- **If subject looks generic/modelled:** Add "candid posture, mid-action gesture, imperfect natural expression, not posed."
- **Do NOT use negative prompts** — rephrase: instead of "no studio lighting," say "practical ambient light sources only."
`,
};
