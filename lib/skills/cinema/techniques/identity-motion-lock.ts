import type { Skill } from "../../types";

export const techniqueIdentityMotionLock: Skill = {
  id: "technique-identity-motion-lock",
  kind: "technique",
  tab: "cinema",
  title: "Technique: Identity Motion Lock (Higgsfield Soul ID)",
  triggers: [
    "identity lock",
    "character consistency",
    "face consistency",
    "same character multiple shots",
    "consistent character",
    "higgsfield",
    "soul id",
    "character across shots",
    "face lock",
    "identity preservation",
  ],
  body: `# Technique: Identity Motion Lock (Higgsfield Soul ID)

## The Problem
Grok Imagine — like all video generation models — struggles to maintain character identity across shots, or even within a single longer clip. Faces drift. Hair color shifts. Clothing changes subtly. When descriptors that define identity are mixed with descriptors that define motion, the model conflates them and trades off fidelity on both.

**Higgsfield's Solution (community-validated):** Separate the prompt into two completely isolated blocks — an **Identity Block** (pure static descriptors) and a **Motion Block** (pure temporal/camera descriptors). Never let these blocks contaminate each other.

## The Two-Block Structure

### IDENTITY BLOCK (paste into every shot of this character)
Contains ONLY stable, non-changing physical descriptors.

**Template:**
\`\`\`
[Character name] — [age range], [skin descriptor], [eye description], [hair detail], [distinguishing mark if any]. Wearing [specific material] [garment], [color], [fit descriptor].
\`\`\`

**Example:**
\`\`\`
Aisha — late 20s, warm golden-brown skin, dark almond eyes, long black hair with slight wave, small mole below left eye. Wearing silk emerald blouse, fitted at waist, with high-waisted cream trousers.
\`\`\`

### MOTION BLOCK (changes per shot)
Contains ONLY temporal and camera information.

**Template:**
\`\`\`
Camera: [named preset]. Action: [what physically changes in this shot]. Style: [named style]. [Aspect ratio]. [Duration]s.
\`\`\`

**Example:**
\`\`\`
Camera: slow dolly-in. Action: she turns her head to look at camera, slight smile. Style: warm golden hour. 16:9. 8s.
\`\`\`

## The Hard Rules
1. **NEVER re-describe face features in the Motion Block** — not even "she smiles" or "her eyes." Put all face references in Identity Block.
2. **NEVER put camera or motion descriptors in the Identity Block** — not "walking," "turning," or any verb.
3. **Clothing details belong in Identity Block** — the Motion Block never references what she's wearing unless she changes clothes (in which case, new Identity Block).
4. **Copy-paste the Identity Block verbatim** across every shot of the same character — do not paraphrase.

## Full Two-Block Prompt Example

**IDENTITY BLOCK:**
"Aisha — late 20s, warm golden-brown skin, dark almond eyes, long black hair with slight wave, small mole below left eye. Wearing silk emerald blouse, fitted at waist, with high-waisted cream trousers."

**MOTION BLOCK (Shot 1):**
"Camera: wide establishing. Action: she walks slowly through a sunlit morning market, browsing stalls. Style: Kodak Portra warm. 16:9. 6s."

**MOTION BLOCK (Shot 2):**
"Camera: slow dolly-in. Action: she stops at a spice stall, reaches forward to pick up a jar. Style: Kodak Portra warm. 16:9. 5s."

**MOTION BLOCK (Shot 3):**
"Camera: medium static. Action: she holds the jar up, examines it in the light, then smiles. Style: Kodak Portra warm. 16:9. 4s."

## Success Rate
**70–80% identity consistency across 2–3 shots** when blocks are cleanly separated. Without separation: ~30–40% consistency. The improvement from this technique is significant — especially for marketing content where brand ambassador consistency matters.

## Grok Mode Notes
- Works in all modes; most effective in **Custom mode** where you control aspect ratio and duration per shot
- For multi-shot sequences: use with **Shot Switch** technique + **Unfixed lens**
- **Quality mode (April 2026):** Generate 4 variants simultaneously — pick the one with best identity retention
`,
};
