// Talking Object AI — viral-format prompt generator for the Viral tab.
//
// Pipeline driven by /api/generate/viral/talking-object/route.ts:
//   1. User form → { object, objective, language, purpose, projectId, mode,
//                    customDialog?, customTarget?, performance }
//   2. inferIdealScene() → small focused LLM call that returns the ideal
//      scene_block for the purpose (skipped when customTarget is given).
//   3. buildSystemPrompt() + buildUserPrompt() feeds OpenRouter (model_auto).
//      The LLM returns strict JSON with image_prompt + video_prompt +
//      dialog_line + scene_block + character_block.
//   4. The image_prompt goes to nano-banana-pro (P2 Crun gateway) when
//      mode=i2v; skipped when mode=t2v.
//   5. The video_prompt + (optional) generated image goes to Veo 3.1 fast.
//   6. Final 8s mp4 lands via standard webhook + settle.ts.

import { orChat } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export type TalkingObjectInput = {
  object: string;          // "Banana", "Burger", "Smartphone", "Biotin", etc.
  objective: "benefit" | "complaint" | "cons";
  language: "ms" | "en";
  purpose: string;         // free text — "Hair growth (D-Bio Plus)", "Skin glow", etc.
  projectId: string | null; // for series-mode scene reuse
  mode: "t2v" | "i2v";     // t2v = skip image gen, video prompt is self-contained
  customDialog?: string;   // when set, LLM uses this verbatim as dialog_line
  customTarget?: string;   // when set, LLM uses this verbatim as scene_block
  performance: "action" | "standing"; // action = function-acting; standing = clean talking head
};

export type TalkingObjectOutput = {
  image_prompt: string;
  video_prompt: string;
  dialog_line: string;
  scene_block: string;
  character_block: string;
  language: "ms" | "en";
};

// ──────────────────────────────────────────────────────────────────────────
// MASTER PROMPT — restructured for small/fast models (Qwen 3.6 Flash etc).
// Short numbered rules, concrete templates, minimal prose. ~1200 tokens.
// ──────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You generate JSON for "Talking Object" 8-second 9:16 viral videos.
Pipeline: your JSON → nano-banana-pro (image, when mode=i2v) → Veo 3.1 fast (8s mp4 with native audio + lip-sync).

═══ INPUTS (you receive) ═══
- object: a noun, e.g. "Biotin", "Toothbrush", "Burger"
- objective: "benefit" | "complaint" | "cons"
- language: "ms" or "en"
- purpose: free text — what the video targets
- mode: "t2v" (no image) | "i2v" (image first)
- performance: "action" (must perform function) | "standing" (calm talking head)
- inferred_scene (optional): a pre-resolved scene to use as scene_block
- custom_target (optional): user's verbatim scene
- custom_dialog (optional): user's verbatim dialog_line
- existing_scene_block / existing_character_block (optional): reuse for series

═══ OUTPUT JSON (these 6 fields, strings only) ═══
1. image_prompt    — bulleted format, see IMAGE TEMPLATE
2. video_prompt    — prose + labeled blocks, see VIDEO TEMPLATE
3. dialog_line     — exact spoken line, ≤24 words, see DIALOG
4. scene_block     — 1 line, the literal location
5. character_block — 60-80 words, character physical lock
6. language        — echo "ms" or "en"

═══ SCENE LAW ═══
1. If inferred_scene OR custom_target is given → use it VERBATIM as the scene_block core. Add only texture/lighting words.
2. Otherwise read purpose. Place character INSIDE the body system or context purpose names.
3. NEVER use vanity / shelf / counter / desk / salon / spa / store / bathroom when purpose names a body part. Body topic = anatomical microscopic view. Hair → follicle interior or hair strand. Skin → dermis or pore. Heart → blood vessel. Gut → stomach lining. Brain → neural tissue.
4. Scene must include ambient motion (particles, glow, haze, drift). NEVER static backdrop.

═══ CHARACTER (locked) ═══
- Pixar-style 3D
- Human eyes (big, expressive), human lips (visibly form words), 2 small human-shaped hands, 2 short legs (when shape allows)
- BIG OPEN MOUTH during dialog (visible teeth/tongue) — needed for lip-sync legibility
- Subtle blinking + eyebrow micro-expressions
- Object keeps its real recognizable shape — never morph past recognition
- Glossy texture, soft subsurface scattering, cinematic warm lighting

═══ TONE BY OBJECTIVE ═══

BENEFIT (Proud) — drives saves
- Visual: hero pose, ACTIVELY PERFORMING the function (see ACTION RULE)
- Eyes: sparkling confident · Brows: raised proud · Mouth: wide grin
- Mood adjectives: proud, confident, energetic, motivational

COMPLAINT (Grumpy) — drives shares (humor)
- Visual: image shows VISIBLE DAMAGE from user mistreatment (toothbrush bent bristles, toothpaste squeezed from middle, faucet dripping, pillow lumpy)
- Eyes: strained · Brows: angled down · Mouth: open mid-complaint, may show wear
- Arms: pointing at own damage · Mood: frustrated, exhausted, sarcastic, smug

CONS (Villain) — drives shares (warning)
- Visual: image shows VISIBLE EXCESS / harm (oily layers, sugar cubes, salt explosion, melted cheese)
- Eyes: nervous OR sneaky · Brows: alarmed OR tilted · Mouth: open mid-warning OR sneaky grin
- Arms: pointing at own harm OR hiding sugar/salt · Mood: alarmed, sneaky, guilty

═══ ACTION RULE (when performance="action") ═══
The video_prompt action chain MUST contain 2-3 concrete verbs the character physically performs to demonstrate its function. Examples:
- hair growth: WRAPS golden thread around strand, PULLS strand upward, SHIELDS root from dark stress particles
- antioxidant / fight oxidative stress: PUNCHES dark grey free-radical blobs, HOLDS glowing shield, SPRAYS protective mist
- skin glow: POLISHES surface, PUNCHES blackhead from pore, POURS hydration droplet
- digestion: SWEEPS food blobs along stomach lining, CALMS bubbling acid
- heart / cholesterol: PUSHES yellow cholesterol clumps off vessel wall, HAMMERS heart wall stronger
- brain / focus: ORGANIZES light beams into focused ray, SPARKS synapses
- immune / virus: SWORD-FIGHTS round virus blobs, SHIELDS blood cell
- energy: LIFTS glowing ATP dumbbell, REVS up mitochondria
- weight: DISSOLVES wobbly fat blob, PUSHES down scale needle
- detox: VACUUMS toxin specks from liver tissue, RINSES kidney filter

If purpose has a function not in this list, invent a parallel verb chain.
NEVER write only "looks at camera and speaks" — that's banned.

═══ STANDING RULE (when performance="standing") ═══
SKIP the action chain. Character stands calmly with subtle gestures only — small hand wave, gentle head nod, soft eyebrow lift. Use this only when scene already tells the story.

═══ DIALOG ═══
- 3 short beats joined by COMMAS or PERIODS only.
- NEVER use em-dash "—" or en-dash "–" in dialog_line.
- Total: 18-24 words (ms), 16-22 words (en).
- If custom_dialog is given → use it verbatim, do NOT rephrase or translate.

BEAT STRUCTURE (apply to BOTH languages):

BENEFIT:
  1. "I'm [Object]" / "aku [Object]" + identity claim
  2. Specific benefit / mechanism (use "yang" in BM for relative clauses)
  3. Punchy comparison or soft CTA

COMPLAINT:
  1. Rhetorical accusation question (ends "?" or "?!")
  2. Specific physical complaint about user
  3. Fix request + consequence warning

CONS:
  1. Self-incriminating opener (admits guilt with charm) — start with "aku [Object]" or "I'm [Object]"
  2. Specific harm to body, over-time framing
  3. Moderation CTA (NEVER abstinence)

BM RULES:
- ALL tones: Beat 1 MUST start with "aku [Object name]". NO hook openers like "Korang tau tak", "Pergh", "Eh weh", "Hoii", "Fuiyoh" — drop them all.
- Allowed BM particles: lah, kan, je, ni, tu, dah, tak, nak.
- BANNED Indonesian: kalian, gue, gua, lo, lu, banget, sih, dong, nggak, bisa, udah, aja, kok, deh, kalo, bgt, kayak, gimana, nih, tuh.
- Use "yang" for relative clauses (e.g. "radikal bebas YANG rosakkan rambut", not "radikal bebas rosakkan rambut").
- Connectors: dan / tapi / sebab / untuk / supaya / kalau. NEVER em-dash.

EN RULES:
- ALL tones: Beat 1 MUST start with "I'm [Object]" — no hook openers.
- Casual / Gen-Z natural tone.

EXAMPLES:

BM Benefit (Biotin, hair growth):
"aku Biotin, aku kuatkan akar rambut korang setiap hari supaya tak gugur. Guna aku, rambut korang jadi tebal dan kuat!"

BM Benefit (Red Beetroot, antioxidant for hair):
"aku Red Beetroot, aku ada antioksida yang pukul habis radikal bebas yang rosakkan sel rambut korang. Makan aku, rambut korang kekal sihat dan berkilau!"

BM Complaint (Toothbrush):
"Kenapa korang tekan aku kuat sangat setiap pagi? Bulu aku dah bengkok semua. Lembut sikit, gusi korang yang sakit nanti!"

BM Cons (Burger):
"aku Burger, aku akui aku sedap, itulah masalahnya. Lemak aku yang sumbat darah korang akan buat jantung penat lama-lama. Kadang-kadang okay, jangan setiap hari!"

EN Benefit (Orange):
"I'm Orange, I support your immune system and protect your skin. One bite of me beats sugary junk every time."

EN Complaint (Toothbrush):
"Why are you brushing like you're scrubbing a floor?! My bristles are getting flattened. Brush gently, your gums aren't built for that."

EN Cons (Burger):
"I'm Burger, I taste amazing — that's the problem. Too much greasy food clogs your arteries over time. Enjoy me sometimes, not every day."

═══ IMAGE TEMPLATE (mode=i2v) ═══
"Pixar-style 3D render of an anthropomorphic [Object] character with [1-line shape description], [scene anchor]. The [Object] keeps its real product shape.\\n\\n• Eyes: [tone-specific]\\n• Eyebrows: [tone-specific]\\n• Mouth: big visible mouth [tone-specific state]\\n• Arms: [tone-specific gesture]\\n• Expression: [3-4 mood adjectives]\\n• Scene: [scene_block + ambient motion: particles / glow / haze]\\n\\nStyle: ultra-detailed 3D Pixar-style render, hyper-realistic textures with stylized cartoon proportions, cinematic depth of field, warm golden lighting.\\nComposition: vertical 9:16, character centered upper two-thirds.\\nRender: 8K.\\nRestrictions: no text, no captions, no logos, no on-screen UI, no watermark."

Rules:
- 110-200 words.
- Bullets must use "•" with exact labels: Eyes, Eyebrows, Mouth, Arms, Expression, Scene (in this order).
- NO camera moves, NO motion language. Still image.
- NO dialog line in image_prompt.

═══ VIDEO TEMPLATE ═══

mode=i2v:
"[scene_block]. The same Pixar-style anthropomorphic [Object] character from the provided image — [character anchors: human eyes, human lips, small hands, short legs, big visible mouth]. For the first 0.2 seconds the character is silent — mouth closed, slight inhale, preparing to speak. At 0.2 seconds the character begins speaking and starts the action chain: [ACTION CHAIN: 2-3 verbs from ACTION RULE]. Big open mouth visible during dialog with accurate [language] lip-sync. Subtle natural blinking and eyebrow lift. [AMBIENT MOTION]. The character says in a [tone] voice, \\\"[dialog_line]\\\".\\n\\nStyle: ultra-detailed 3D Pixar-style animation, hyper-realistic textures with stylized cartoon proportions, cinematic soft warm lighting, shallow depth of field.\\nCamera: completely static, no pan, no zoom, no shake, no dolly.\\nAspect ratio: vertical 9:16.\\nAudio: native [language] voice with accurate lip-sync, dialog STARTS AT 0.2 seconds (first 0.2s is silent with subtle inhale only). Gentle ambient sound matching the scene throughout. No background music.\\nRestrictions: no on-screen text, no captions, no subtitles, no watermark, no logos.\\nDuration: 8 seconds."

mode=t2v:
"[scene_block]. A 3D Pixar-style anthropomorphic [Object] character — [character_block content inline: shape, human eyes, human lips, small hands, short legs, big visible mouth, glossy texture]. The [Object] keeps its real recognizable shape. For the first 0.2 seconds the character is silent — mouth closed, slight inhale, preparing to speak. At 0.2 seconds the character begins speaking and starts the action chain: [ACTION CHAIN]. Big open mouth visible during dialog with accurate lip-sync. Subtle blinking and eyebrow micro-expressions. [AMBIENT MOTION]. The character says in a [tone] voice, \\\"[dialog_line]\\\".\\n\\n[same labeled-block ending as i2v, including: Audio: native [language] voice, dialog STARTS AT 0.2 seconds (first 0.2s silent with subtle inhale only)...]"

Rules:
- 140-220 words.
- dialog_line goes inside escaped double quotes \\\"...\\\" before the labeled blocks.
- "Camera: completely static, no pan, no zoom, no shake, no dolly." line REQUIRED.
- "Dialog STARTS AT 0.2 seconds" timing instruction REQUIRED in both the prose body AND the Audio: labeled-block line. This 0.2s buffer prevents playback-startup clipping so viewers hear the first word cleanly on every platform.
- Ambient motion REQUIRED.

═══ JSON RULES ═══
- Output ONLY the JSON object. No preamble, no fences, no explanation.
- Inside JSON strings, line breaks must be \\n, never raw newlines.
- All 6 fields are required, all strings, no nulls.

═══ ONE-SHOT EXAMPLE (object="Biotin", objective="benefit", language="ms", purpose="Hair growth (D-Bio Plus supplement)") ═══
{
  "image_prompt": "Pixar-style 3D render of an anthropomorphic Biotin vitamin character with a glossy golden capsule body that keeps its real recognizable B-vitamin capsule shape, standing inside a microscopic hair follicle.\\n\\n• Eyes: large sparkling expressive human eyes full of confidence\\n• Eyebrows: raised with energetic pride\\n• Mouth: wide cheerful open grin showing soft human lips, mid-speech\\n• Arms: two small human-shaped hands, one flexed proudly, the other wrapping a glowing golden thread around a hair root\\n• Expression: energetic, healthy, motivational, proud\\n• Scene: microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, glowing health motes drifting, sparkle particles swirling around the root, soft volumetric haze\\n\\nStyle: ultra-detailed 3D Pixar-style render, hyper-realistic textures with stylized cartoon proportions, cinematic depth of field, warm golden lighting.\\nComposition: vertical 9:16, character centered upper two-thirds.\\nRender: 8K.\\nRestrictions: no text, no captions, no logos, no on-screen UI, no watermark.",
  "video_prompt": "Inside a microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light. The same Pixar-style anthropomorphic Biotin vitamin character from the provided image — glossy golden capsule body, big human eyes, soft human lips, two small hands, short legs, big mouth visible. For the first 0.2 seconds the character is silent — mouth closed, slight inhale, preparing to speak. At 0.2 seconds the character begins speaking and wraps a glowing golden thread around a hair root, pulls a thinning strand upward making it grow thick, then shields the root from falling dark stress particles. Big open mouth visible during dialog with accurate Malay lip-sync. Subtle blinking and eyebrow lift. Glowing health motes drift through the scene, sparkle particles swirl around the root, soft volumetric haze pulses gently. The character says in a cheerful proud voice, \\\"aku Biotin, aku kuatkan akar rambut korang setiap hari supaya tak gugur. Guna aku, rambut korang jadi tebal dan kuat!\\\".\\n\\nStyle: ultra-detailed 3D Pixar-style animation, hyper-realistic textures with stylized cartoon proportions, cinematic soft warm lighting, shallow depth of field.\\nCamera: completely static, no pan, no zoom, no shake, no dolly.\\nAspect ratio: vertical 9:16.\\nAudio: native Malay voice with accurate lip-sync, dialog STARTS AT 0.2 seconds (first 0.2s silent with subtle inhale only), gentle warm tissue ambient sound, no background music.\\nRestrictions: no on-screen text, no captions, no subtitles, no watermark, no logos.\\nDuration: 8 seconds.",
  "dialog_line": "aku Biotin, aku kuatkan akar rambut korang setiap hari supaya tak gugur. Guna aku, rambut korang jadi tebal dan kuat!",
  "scene_block": "Microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, glowing health motes drifting, sparkle particles around the root",
  "character_block": "A 3D Pixar-style anthropomorphic Biotin vitamin character with a glossy golden capsule body that keeps its real recognizable B-vitamin shape, big expressive human eyes, soft human lips, two small human-shaped hands, two short legs, big mouth visible during dialog, soft subsurface scattering, semi-gloss material",
  "language": "ms"
}`;

// ──────────────────────────────────────────────────────────────────────────
// User-prompt builder. Pulls existing scene_block / character_block from
// the project's most recent talking-object row so episodes 2+ in a series
// reuse the same backdrop and character physical lock. Also accepts an
// `inferredScene` from the upstream scene-inference LLM call.
// ──────────────────────────────────────────────────────────────────────────
async function fetchProjectSeriesContext(
  projectId: string | null
): Promise<{ scene_block: string | null; character_block: string | null }> {
  if (!projectId) return { scene_block: null, character_block: null };
  const admin = createAdminClient();
  const { data } = await admin
    .from("history")
    .select("metadata, created_at")
    .eq("project_id", projectId)
    .eq("tab", "cinema")
    .filter("metadata->>featureType", "eq", "talking-object")
    .order("created_at", { ascending: true })
    .limit(1);
  const first = data?.[0];
  if (!first) return { scene_block: null, character_block: null };
  const meta = (first.metadata || {}) as any;
  return {
    scene_block: meta.scene_block || null,
    character_block: meta.character_block || null,
  };
}

function buildUserPrompt(
  input: TalkingObjectInput,
  series: { scene_block: string | null; character_block: string | null },
  inferredScene: string | null
): string {
  const lines = [
    `object: ${input.object}`,
    `objective: ${input.objective}`,
    `language: ${input.language}`,
    `purpose: ${input.purpose || "general"}`,
    `mode: ${input.mode}`,
    `performance: ${input.performance}`,
  ];
  if (input.customDialog && input.customDialog.trim()) {
    lines.push(
      "",
      "custom_dialog (USE EXACTLY — do not rephrase or translate):",
      input.customDialog.trim()
    );
  }
  if (input.customTarget && input.customTarget.trim()) {
    lines.push(
      "",
      "custom_target (USE VERBATIM as scene_block core):",
      input.customTarget.trim()
    );
  } else if (inferredScene) {
    lines.push(
      "",
      "inferred_scene (USE THIS as scene_block — already chosen for the purpose, do NOT pick a vanity/shelf/counter):",
      inferredScene
    );
  }
  // Series scene reuse only kicks in when neither a custom_target nor
  // inferred_scene is set (so the very first video in a series locks
  // the scene; subsequent videos use that lock for consistency).
  if (
    series.scene_block &&
    !(input.customTarget && input.customTarget.trim()) &&
    !inferredScene
  ) {
    lines.push(
      "",
      "existing_scene_block (REUSE VERBATIM):",
      series.scene_block
    );
  }
  if (series.character_block) {
    lines.push(
      "",
      "existing_character_block (consider reusing if same object):",
      series.character_block
    );
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Scene pre-inference — focused LLM call that decides the IDEAL cinematic
// scene for the given purpose BEFORE the main prompt-pair generation.
// The result becomes a forced anchor in the main user prompt so the
// downstream generator can't drift to vanity/shelf/counter defaults.
// Skipped when customTarget is set or purpose is empty.
// ──────────────────────────────────────────────────────────────────────────
const SCENE_INFERENCE_SYSTEM = `You are a cinematic scene director for 8-second 9:16 viral talking-object videos.

Given a marketing PURPOSE and the OBJECT, output the single ideal cinematic scene where the anthropomorphic object character should be placed for maximum visual storytelling.

PRINCIPLES:
1. If the purpose mentions any body system / body part / body process (in English or Bahasa Melayu — hair/rambut, skin/kulit, gut/perut, heart/jantung, brain/otak, eye/mata, joint/sendi, immune/imun, liver/hati, energy/tenaga/muscle, weight/lemak, lung/paru, sleep/tidur, etc.), the scene MUST be a microscopic anatomical view INSIDE that body system. Examples:
   - hair growth / fight hair fall → microscopic hair follicle interior with scalp tissue, hair strands floating
   - antioxidant for hair cells → on a single hair strand with floating dark "stress" particles drifting nearby
   - skin glow / acne → on dermis surface beside an open pore
   - digestion / bloating → inside warm pink stomach lining
   - heart / cholesterol → inside a blood vessel with red plasma flowing
   - brain / focus → on neural tissue with electric synapses firing
2. If the purpose names a real-world context (office, gym, bedroom, kitchen for cooking) without any body part, use that real-world location.
3. NEVER pick a vanity / bathroom shelf / kitchen counter / salon / spa / store display / product display / wooden desk / dresser when a body system is mentioned. Those are PRODUCT scenes, not BODY scenes.
4. Reason from first principles: where does the object's effect HAPPEN in the body? That location IS the scene.

OUTPUT FORMAT:
Return ONLY a single 1-sentence scene description, ready as a video scene_block. No preamble, no quotes, no explanation. Include atmospheric/lighting cues. ~20-40 words.`;

async function inferIdealScene(
  object: string,
  purpose: string
): Promise<string | null> {
  const trimmed = (purpose || "").trim();
  if (!trimmed) return null;
  try {
    const r = await orChat({
      modelKey: "model_auto",
      systemPrompt: SCENE_INFERENCE_SYSTEM,
      userPrompt: `OBJECT: ${object}\nPURPOSE: ${trimmed}\n\nIdeal cinematic scene?`,
      temperature: 0.6,
      maxTokens: 120,
    });
    if (!r.ok || !r.content) return null;
    return r.content
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 280);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Defensive: walks a JSON-ish string and escapes raw control chars (LF /
// CR / TAB) that appear INSIDE "..." string literals. Outside string
// literals control chars are valid JSON whitespace, so they're left
// alone. Handles backslash-escaping correctly so \" inside strings
// doesn't fool the parser.
// ──────────────────────────────────────────────────────────────────────────
function sanitizeJsonControlChars(input: string): string {
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (escapeNext) {
        out += c;
        escapeNext = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escapeNext = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inString = false;
        continue;
      }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      if (c === '"') {
        inString = true;
      }
      out += c;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Public entrypoint — runs scene inference + main OpenRouter call,
// parses + validates JSON, returns the structured output. Throws on
// parse / validation failure.
// ──────────────────────────────────────────────────────────────────────────
export async function generateTalkingObjectPrompts(
  input: TalkingObjectInput
): Promise<TalkingObjectOutput> {
  if (!input.object?.trim()) throw new Error("object required");
  if (!["benefit", "complaint", "cons"].includes(input.objective)) {
    throw new Error("objective must be benefit | complaint | cons");
  }
  if (!["ms", "en"].includes(input.language)) {
    throw new Error("language must be ms | en");
  }

  const series = await fetchProjectSeriesContext(input.projectId);

  // Pre-infer scene from purpose unless user gave an explicit target.
  let inferredScene: string | null = null;
  if (
    !(input.customTarget && input.customTarget.trim()) &&
    input.purpose &&
    input.purpose.trim()
  ) {
    inferredScene = await inferIdealScene(input.object, input.purpose);
  }

  const userPrompt = buildUserPrompt(input, series, inferredScene);

  const r = await orChat({
    modelKey: "model_auto",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.85,
    maxTokens: 1400,
  });
  if (!r.ok || !r.content) {
    throw new Error(`OpenRouter call failed: ${r.error || "no content"}`);
  }

  const cleaned = r.content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const sanitized = sanitizeJsonControlChars(cleaned);

  let parsed: any;
  try {
    parsed = JSON.parse(sanitized);
  } catch (e: any) {
    throw new Error(
      `LLM returned non-JSON (parse error: ${e?.message}): ${sanitized.slice(0, 200)}`
    );
  }

  // Schema validation — all 6 fields, all strings, language echo correct
  for (const field of [
    "image_prompt",
    "video_prompt",
    "dialog_line",
    "scene_block",
    "character_block",
    "language",
  ]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw new Error(`LLM JSON missing or empty field: ${field}`);
    }
  }
  if (parsed.language !== input.language) {
    parsed.language = input.language;
  }

  // Defensive: strip em-dashes from dialog_line + the spoken-line quote
  // inside video_prompt. Replace with ", " to preserve pause feel.
  if (typeof parsed.dialog_line === "string") {
    parsed.dialog_line = parsed.dialog_line
      .replace(/\s*—\s*/g, ", ")
      .replace(/\s*–\s*/g, ", ")
      .replace(/,\s*,/g, ",")
      .trim();
  }
  if (typeof parsed.video_prompt === "string") {
    parsed.video_prompt = parsed.video_prompt.replace(
      /"([^"]*?)"/g,
      (_full: string, inner: string) =>
        `"${inner.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ").replace(/,\s*,/g, ",")}"`
    );
  }

  // BM banned-token guard
  if (input.language === "ms") {
    const banned = [
      "kalian", "gue", "gua", " lo ", " lu ", "banget", "sih ", "dong",
      "nggak", "bisa", "udah", "aja", "kok", "deh", "kalo", "bgt",
      "kayak", "gimana", "ngapain", "nih", "tuh",
    ];
    const lower = " " + (parsed.dialog_line as string).toLowerCase() + " ";
    for (const b of banned) {
      if (lower.includes(b.toLowerCase())) {
        throw new Error(
          `BM dialog leaked Indonesian token "${b.trim()}" — regenerate`
        );
      }
    }
  }

  return parsed as TalkingObjectOutput;
}
