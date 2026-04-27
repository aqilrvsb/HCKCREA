import type { Skill } from "../types";

export const decisionBananaVsGpt2: Skill = {
  id: "banana-vs-gpt2",
  kind: "decision-tree",
  tab: "image",
  title: "Banana vs GPT Image 2 — Full Decision Matrix",
  triggers: [
    "which model",
    "banana or gpt",
    "gemini or openai image",
    "which image model",
    "model choice",
    "image model decision",
    "what model should i use",
    "banana pro vs gpt image 2",
    "gemini image vs openai",
    "best model for",
  ],
  body: `# Banana Pro vs GPT Image 2 — Full Decision Matrix

Fetch this skill FIRST when a user describes an image goal. Route to the correct model before writing any prompt.

## The One-Line Rule
> **Text fidelity matters → GPT-2. Atmospheric photoreal SEA faces → Banana. Structured visual planning → GPT-2. Multi-ref composite → Banana.**

---

## Full Decision Matrix

| Use Case | Model | Reason | Key Prompt Feature |
|---|---|---|---|
| **Asian / Malay / hijabi faces** | Banana | Native atmospheric portraiture, warm SEA skin tones, Malay face rendering | Reference Image Anchor phrase first; 85mm lens |
| **Product close-up (no text)** | GPT-2 | Instruction following for exact product appearance; label adherence | 5-section prompt; \`input_fidelity="high"\` for ref |
| **Text on packaging / label** | **GPT-2 (decisive)** | 95% multilingual accuracy vs Banana's 60-70%; degrades past 25 chars | Enclose text in quotes; "render verbatim" |
| **Stylized cel-shaded / anime** | Route to Midjourney | Both models lack granular style control; neither has --stylize or LoRA | N/A — flag to user |
| **Character + product composite** | Banana | Multi-ref native (up to 14 refs); character consistency in conversational chain | Dual-reference anchor; keep in same session |
| **Photoreal hero shot (product)** | GPT-2 | \`input_fidelity="high"\` for identity preservation; instruction-exact framing | 5-section prompt; Constraints section critical |
| **Editorial / magazine fashion** | Banana | Atmospheric depth default; environmental complexity native | Photographer trigger phrase + lens + colour grade |
| **Surreal / dreamy / abstract** | Banana | Tolerates ambiguity; atmospheric abstraction without over-resolving | Viviane Sassen or abstract descriptors; no rigid structure |
| **7-image e-commerce listing** | Banana | Conversational chain consistency; product locks across all 7 in one session | Start all 7 in same conversation; dual-reference anchor |
| **Infographic / data viz** | **GPT-2 (decisive)** | Structured visual reasoning + 95% text accuracy; Banana cannot do layout | 5-section prompt; list text elements verbatim |
| **Multilingual packaging text** | **GPT-2 (decisive)** | Mixed-script accuracy (BM + EN + 中文 + Arabic) in one frame | Specify each language separately in quotes |
| **UGC lifestyle (character + product)** | Banana | Atmospheric lifestyle native; conversational iteration for feedback | Character ref Slot 1; style trigger phrase |
| **Virtual try-on** | GPT-2 | 16 refs + \`input_fidelity="high"\` for garment texture preservation | Multi-ref garment inputs; \`input_fidelity="high"\` |
| **Transparent background cutout** | GPT-2 | Native alpha output via /edit endpoint | Use /edit endpoint; specify "transparent background" |
| **Billboard / signage with exact text** | **GPT-2 (mandatory)** | 95%+ multilingual; Banana unreliable for headline copy | Each text in quotes; "render verbatim" |
| **Hijabi editorial (atmospheric)** | Banana | Warm SEA Muslim facial rendering; environmental fashion depth | Vogue Arabia or Leibovitz trigger; 85mm + jewel tones |
| **Hijabi editorial (text on clothing/sign)** | GPT-2 | When Arabic calligraphy or text on garment must be exact | Specify script direction; "exact character rendering" |
| **Amazon / Lazada listing set** | Banana (chain) + GPT-2 (infographic) | Banana for images 1-4,6 in chain; GPT-2 for image 5 (infographic) and 7 (text packaging) | Split workflow; see compositeAmazonListing |

---

## Model Capability Summary

### Banana Pro (Gemini 2.5 Flash Image / Nano Banana 2)
**Wins:**
- Atmospheric photorealism and environmental depth
- Asian / Malay / hijabi face warmth and accuracy
- Multi-image input: up to 3 refs (Flash tier), 14 refs (Pro tier)
- Conversational iterative editing (product consistency across session)
- Speed: 5-10 seconds per image
- Multilingual text (CJK, Arabic, Devanagari) — reliable up to ~25 chars
- Surreal and ambiguous scenes — tolerates loose prompts

**Limitations:**
- Text degrades past ~25 characters (60-70% accuracy on long copy)
- Character drift after 5+ edits → restart conversation
- No negative prompts — must rephrase positively
- No granular style parameters (no --stylize, no LoRA)
- Multi-person scale issues

### GPT Image 2 (OpenAI)
**Wins:**
- Text rendering: 95%+ accuracy across all scripts and languages
- Instruction following: 1512 ELO (vs Banana's 1271)
- \`input_fidelity="high"\` for precise identity/garment preservation in edits
- Virtual try-on: 16 ref images
- Structured visuals: infographics, UI mockups, layout planning
- Native Thinking Mode plans composition before generating
- Transparent background via /edit endpoint
- Knowledge base for recognisable branded contexts

**Limitations:**
- Overcleaned realism — counter-prompt with "gritty raw, not over-cleaned"
- No atmospheric depth — clinical rather than felt
- Style control blunt vs Banana for editorial aesthetic
- Knowledge cutoff: December 2025
- Filter inconsistency for fashion/body content
- 2K reliable resolution ceiling

---

## Prompt Formula Reminders

**Banana canonical formula (Google Cloud):**
Subject → Action/Pose → Location/Context → Composition/Framing → Style/Aesthetic → Lighting → Camera/Lens → Colour Grade → Materiality/Texture

**GPT-2 5-section structure (fal.ai):**
1. Scene: [environment, time, background]
2. Subject: [main focus]
3. Important details: [materials, lighting, lens, composition, mood]
4. Use case: [editorial / product / UI / poster]
5. Constraints: [what must not drift, what must not appear]

---

## Quick Routing Flowchart

1. Does the image need readable text? → **GPT-2**
2. Is this virtual try-on or transparent background? → **GPT-2**
3. Is this a structured layout (infographic, UI)? → **GPT-2**
4. Is this a Malay/hijabi/SEA face in atmospheric context? → **Banana**
5. Does it need multi-ref composite (product + character)? → **Banana**
6. Is this editorial fashion needing depth/atmosphere? → **Banana**
7. Is this cel-shaded/anime/illustrative? → **Route to Midjourney**
8. Is it a 7-image listing chain? → **Banana (images 1-4,6) + GPT-2 (images 5,7)**
`,
};
