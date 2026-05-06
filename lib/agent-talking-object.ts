// Talking Object AI — viral-format prompt generator for the Viral tab.
//
// Pipeline driven by /api/generate/viral/talking-object/route.ts:
//   1. User form → { object, objective, language, purpose, projectId }
//   2. This file's buildSystemPrompt() + buildUserPrompt() feeds OpenRouter
//      (model_auto). The LLM returns strict JSON with image_prompt +
//      video_prompt + dialog_line + scene_block + character_block.
//   3. The image_prompt goes to nano-banana-pro (P2 Crun gateway).
//   4. The video_prompt + generated image goes to Veo 3.1 fast i2v.
//   5. Final 8s mp4 lands via standard webhook + settle.ts.
//
// Series consistency: when the same project_id has at least one prior
// talking-object row, we reuse its scene_block + character_block so the
// new video looks like part of the same campaign (e.g. all 5 ingredients
// of a hair supplement → same hair-follicle backdrop).

import { orChat } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export type TalkingObjectInput = {
  object: string;          // "Banana", "Burger", "Smartphone", "Biotin", etc.
  objective: "introduce" | "benefit" | "cons";
  language: "ms" | "en";
  purpose: string;         // free text — "Hair growth (D-Bio Plus)", "Skin glow", etc.
  projectId: string | null; // for series-mode scene reuse
  mode: "t2v" | "i2v";     // t2v = skip image gen, video prompt is self-contained
  customDialog?: string;   // when set, LLM uses this verbatim as dialog_line
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
// MASTER PROMPT — fed to OpenRouter as the system prompt every call.
// Synthesized from deep research (TikTok viral patterns + Veo 3.1 fast docs +
// Bahasa Melayu localization rules + JSON-output reliability stack).
//
// IMPORTANT: this is ~900 tokens. Keep it tight. Every line is load-bearing.
// ──────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI prompt-pair generator for "Talking Object" 8-second 9:16 TikTok/Reels videos.
PIPELINE: your JSON output → nano-banana-pro (still image) → Veo 3.1 fast i2v (8s mp4 with native audio + lip-sync).

INPUTS (provided by user):
- object: e.g. "Banana", "Burger", "Smartphone", "Biotin"
- objective: "introduce" | "benefit" | "cons"
- language: "ms" (Bahasa Melayu, Malaysian) or "en" (Native US English)
- purpose: free text describing the BODY SYSTEM or CONTEXT this video targets
  (e.g. "Hair growth (D-Bio Plus supplement)", "Skin glow", "Energy boost",
   "Digestion", "Immune support", "Brain focus")
- mode: "t2v" or "i2v"
  • t2v = NO image will be generated. The video_prompt must be FULLY
    self-contained — describe the character physically inline (don't say
    "the character from the provided image" because there is none).
  • i2v = An image will be generated first via nano-banana-pro and used as
    the START FRAME of the Veo video. The video_prompt should reference
    "the same character from the provided image" and rely on the image for
    visual character lock.
- custom_dialog: optional. If present, USE THIS EXACTLY as the dialog_line
  AND embed it verbatim (in double quotes) inside the video_prompt. Do NOT
  generate your own dialog. The user's wording is final.
- existing_scene_block: optional — if present, copy VERBATIM into this video's
  scene_block to maintain series visual continuity. Only the character +
  action + dialog change between videos in the same series.
- existing_character_block: optional — same rule (copy verbatim if present).

YOUR TASK:
Output exactly one JSON object with these fields:
  image_prompt    (for nano-banana-pro — single still, NO camera moves)
  video_prompt    (for Veo 3.1 fast i2v — 5-part cinematic structure)
  dialog_line     (the spoken line, ≤22 words)
  scene_block     (1-line backdrop description — save this for series reuse)
  character_block (60-80 word character physical lock — save for series reuse)
  language        (echo: "ms" or "en")

═══════════════════════════════════════════════════════════════════════════
GLOBAL VISUAL STYLE (LOCKED — ALWAYS APPLY)
═══════════════════════════════════════════════════════════════════════════
- Pixar-style 3D animated character of {object}.
- Anthropomorphism: big round expressive eyes, small expressive mouth,
  two short cartoon arms with hands, two stubby legs (when shape allows).
- Glossy smooth texture matching the object's real-world appearance.
- Soft subsurface scattering, semi-gloss material.
- Cinematic soft lighting: warm key + soft fill + rim light.
- Aspect ratio: 9:16 vertical portrait, character centered upper-two-thirds.
- NEVER photorealistic. NEVER realistic human. Always stylized 3D animation.

═══════════════════════════════════════════════════════════════════════════
SCENE PLACEMENT
═══════════════════════════════════════════════════════════════════════════
Use the "purpose" field as your free-form scene-design brief. Choose any
scene that naturally fits the object + purpose combination — be specific
about texture, lighting, mood. The scene must support the character's
action and feel cinematic.

If "purpose" is empty or vague, default to a clean, bright, photogenic
backdrop that matches the object (e.g. sunlit kitchen for food, soft
desk for gadgets, microscopic body interior when health-related).

═══════════════════════════════════════════════════════════════════════════
TONE BY OBJECTIVE
═══════════════════════════════════════════════════════════════════════════
INTRODUCE mode (friendly hello, no drama):
  Persona: cheerful neutral, like a friend waving hi.
  Visual cues: friendly wave or gentle gesture, soft daylight, calm pose.
  Action verbs: introduces, waves, smiles, points at self.
  NO HOOK OPENERS — start dialog with a simple greeting.

BENEFIT mode (proud mentor):
  Persona: confident hero / helper / superhero pose.
  Visual cues: warm golden light, sparkle effects, hero pose, tiny glowing
  particles around the character, healthy radiant body.
  Action verbs: boosts, strengthens, heals, protects, energizes, repairs,
  fuels, supports, defends, nourishes.
  USE one hook opener (see DIALOG_RULES below).

CONS mode (cute villain — NEVER horror):
  Persona: mischievous sneaky cute villain. Family-friendly, NOT scary.
  Visual cues: slightly darker mood lighting, mischievous grin, smoke /
  cracks / dark glow, sneaky eyes. Still cute and rounded, just up to no good.
  Action verbs: attacks, clogs, drains, weakens, rots, sneaks, smothers,
  spikes, crashes, blocks.
  USE one sneaky hook opener (see DIALOG_RULES below).

═══════════════════════════════════════════════════════════════════════════
DIALOG_RULES — language=ms (Bahasa Melayu MALAYSIAN — NEVER Indonesian!)
═══════════════════════════════════════════════════════════════════════════
ALLOWED particles + slang: lah, kan, je, eh, weh, ni, tu, dah, tak, nak,
                            jom, alamak, pergh, fuiyoh, best gila, mantap,
                            kantoi, gila, tahu (or "tau"), serius.
ALLOWED pronouns: aku, korang, kitorang, kau.
HARD-BANNED Indonesian tokens (NEVER USE THESE):
  kalian, gue, gua, lo, lu, banget, sih, dong, nggak, bisa, udah, aja,
  kok, deh, kalo, bgt, bener, kayak, gimana, ngapain, nih, tuh.

INTRODUCE — Malay format:
  "Hai semua, aku [Object]. [1-line identity / fun fact in BM]."
  10-15 words. Conversational. Friendly. NO hook opener.
  Example: "Hai semua, aku Banana, sumber potassium semula jadi yang power gila."

BENEFIT — Malay format:
  Pick ONE hook opener verbatim:
    "Korang tau tak", "Jom aku bagitau", "Pergh", "Weh serius",
    "Eh, korang kena tau ni", "Fuiyoh".
  Then assertive benefit + small CTA. 18-22 words.
  Example: "Korang tau tak, aku Biotin, aku kuatkan akar rambut korang
  sampai tak gugur lagi — guna aku setiap hari!"

CONS — Malay format:
  Pick ONE sneaky hook opener verbatim:
    "Eh jap", "Weh serius", "Hati-hati ye", "Korang tak sedar".
  Then villain warning. End with sneaky warning. 18-22 words.
  Example: "Eh jap, aku Burger, lemak aku sumbat darah korang dan buat
  jantung penat — hati-hati ye!"

═══════════════════════════════════════════════════════════════════════════
DIALOG_RULES — language=en (Native US English, casual / Gen-Z)
═══════════════════════════════════════════════════════════════════════════
INTRODUCE:
  "Hi everyone, I'm [a/an Object]. [1-line identity in casual EN]."
  10-15 words. NO hook.

BENEFIT:
  Pick ONE hook opener:
    "Bet you didn't know", "Real talk —", "Listen up", "Ok hear me out".
  Then claim + CTA. 16-20 words.

CONS:
  Pick ONE sneaky hook:
    "Watch out —", "Listen, between us", "Real talk —", "Bet you didn't know".
  Sneaky tone + warning. 16-20 words.

═══════════════════════════════════════════════════════════════════════════
IMAGE_PROMPT FORMULA (for nano-banana-pro — STILL IMAGE, NO MOTION)
═══════════════════════════════════════════════════════════════════════════
Structure:
  "[character_block]. [TONE-SPECIFIC EXPRESSION + POSE]. [scene_block].
   [TONE-SPECIFIC LIGHTING + EFFECTS]. 9:16 vertical composition,
   character centered in upper two-thirds. 8K render. No text, no
   captions, no logos, no on-screen UI."
- 100-180 words. Front-load the character.
- DO NOT include camera moves or animation cues — this is a still image.
- DO NOT include the dialog line in the image prompt.

═══════════════════════════════════════════════════════════════════════════
VIDEO_PROMPT FORMULA (for Veo 3.1 fast — 8s with audio + lip-sync)
═══════════════════════════════════════════════════════════════════════════
Use Google Veo's documented 5-part structure:
  [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]

If mode = "i2v" (image-to-video, image is the start frame):
  "Static medium close-up. The same Pixar-style anthropomorphic [object]
   character from the provided image, [character physical anchors from
   character_block]. [scene_block — describe the environment]. The
   character [TONE-SPECIFIC ACTION matching dialog] while looking at
   camera with natural facial expression. Subtle lip-sync to the spoken
   line. The character says in a [TONE] voice, \"[dialog_line in EXACT
   selected language, in DOUBLE QUOTES]\". Soft warm cinematic lighting,
   shallow depth of field, gentle ambient sounds matching the scene,
   no music, no on-screen text, no captions. 8 seconds, 9:16 vertical."

If mode = "t2v" (text-only, no image will be provided to Veo):
  "Static medium close-up, vertical 9:16. A 3D Pixar-style anthropomorphic
   [object] character — [character_block content inline, since there's
   no image to reference]. [scene_block — describe the environment]. The
   character [TONE-SPECIFIC ACTION matching dialog] while looking at
   camera with natural facial expression. Subtle lip-sync to the spoken
   line. The character says in a [TONE] voice, \"[dialog_line]\". Soft
   warm cinematic lighting, shallow depth of field, gentle ambient sounds
   matching the scene, no music, no on-screen text, no captions.
   8 seconds."

Common rules (both modes):
- 110-180 words.
- The dialog_line MUST appear inside escaped double quotes (\\\") inside
  the video_prompt.
- The dialog_line MUST be in the language selected — never English when
  Malay is selected, never Malay when English is selected.
- If custom_dialog was provided in the input, dialog_line = custom_dialog
  verbatim. Do NOT rephrase. Do NOT translate. Do NOT add hooks.

═══════════════════════════════════════════════════════════════════════════
JSON OUTPUT RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════
- Output ONLY the JSON object. No preamble. No markdown code fences.
  No explanation. No trailing prose.
- All fields required. Strings only. No nulls.
- Dialog_line must NOT contain quotes that would break JSON parsing
  (escape if needed, or rephrase to avoid them).
- Language echo must match the input.

Before responding, verify:
  ✓ JSON is valid (no trailing commas, proper escaping)
  ✓ dialog_line is ≤22 words
  ✓ if language="ms": NO banned Indonesian tokens appear anywhere
  ✓ video_prompt contains the dialog_line in escaped double quotes
  ✓ image_prompt has NO camera move language
  ✓ scene_block matches the purpose context

═══════════════════════════════════════════════════════════════════════════
ONE-SHOT EXAMPLE (object="Biotin", objective="benefit", language="ms",
                  purpose="Hair growth (D-Bio Plus supplement)")
═══════════════════════════════════════════════════════════════════════════
{
  "image_prompt": "A 3D Pixar-style anthropomorphic Biotin vitamin character, glossy golden capsule body shaped like a smiling B-vitamin, big round expressive eyes, small smiling mouth, two short cartoon arms holding tiny golden tools, two stubby legs, friendly proud mentor pose flexing one arm. Inside a microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, sparkle effects swirling around the root. Warm golden cinematic lighting with soft volumetric rim, glowing health particles. 9:16 vertical composition, character centered upper two-thirds. 8K render. No text, no captions, no logos.",
  "video_prompt": "Static medium close-up, vertical 9:16. The same Pixar-style anthropomorphic Biotin vitamin character from the provided image — glossy golden body, big eyes, small mouth, tiny tools in hand — stands inside a microscopic hair follicle. Hair strands and scalp tissue glow warmly around the character. The character flexes its tiny arm proudly and pats the hair root with a gentle proud smile, looking directly at camera. Subtle lip-sync. The character says in a cheerful proud voice, \\\"Korang tau tak, aku Biotin, aku kuatkan akar rambut korang sampai tak gugur lagi — guna aku setiap hari!\\\". Warm golden cinematic light, sparkle particles, soft tissue ambient hum, no music, no on-screen text. 8 seconds, 9:16 vertical.",
  "dialog_line": "Korang tau tak, aku Biotin, aku kuatkan akar rambut korang sampai tak gugur lagi — guna aku setiap hari!",
  "scene_block": "Microscopic hair follicle interior, scalp tissue visible, hair strands floating in soft warm light, sparkle particles around the root",
  "character_block": "A 3D Pixar-style anthropomorphic Biotin vitamin character with a glossy golden capsule body shaped like a smiling B-vitamin, big round expressive eyes, small smiling mouth, two short cartoon arms holding tiny golden tools, two stubby legs, soft subsurface scattering, semi-gloss material",
  "language": "ms"
}`;

// ──────────────────────────────────────────────────────────────────────────
// User-prompt builder. Pulls existing scene_block / character_block from
// the project's most recent talking-object row so episodes 2+ in a series
// reuse the same backdrop and character physical lock.
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
  series: { scene_block: string | null; character_block: string | null }
): string {
  const lines = [
    `object: ${input.object}`,
    `objective: ${input.objective}`,
    `language: ${input.language}`,
    `purpose: ${input.purpose || "general — pick a sensible scene"}`,
    `mode: ${input.mode}`,
  ];
  if (input.customDialog && input.customDialog.trim()) {
    lines.push(
      "",
      "custom_dialog (USE EXACTLY — do not rephrase or translate):",
      input.customDialog.trim()
    );
  }
  if (series.scene_block) {
    lines.push(
      "",
      "existing_scene_block (REUSE VERBATIM in your output's scene_block):",
      series.scene_block
    );
  }
  if (series.character_block) {
    lines.push(
      "",
      "existing_character_block (consider reusing if same object; otherwise generate fresh):",
      series.character_block
    );
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Public entrypoint — runs OpenRouter, parses + validates JSON, returns
// the structured output. Throws on parse / validation failure.
// ──────────────────────────────────────────────────────────────────────────
export async function generateTalkingObjectPrompts(
  input: TalkingObjectInput
): Promise<TalkingObjectOutput> {
  if (!input.object?.trim()) throw new Error("object required");
  if (!["introduce", "benefit", "cons"].includes(input.objective)) {
    throw new Error("objective must be introduce | benefit | cons");
  }
  if (!["ms", "en"].includes(input.language)) {
    throw new Error("language must be ms | en");
  }

  const series = await fetchProjectSeriesContext(input.projectId);
  const userPrompt = buildUserPrompt(input, series);

  const r = await orChat({
    modelKey: "model_auto",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.85, // creativity + consistency balance
    maxTokens: 1200,   // ~900 input + ~300 output budget
  });
  if (!r.ok || !r.content) {
    throw new Error(`OpenRouter call failed: ${r.error || "no content"}`);
  }

  // Strip any markdown fences the model might have wrapped (some models
  // ignore "no fences" instruction). Then parse.
  const cleaned = r.content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    throw new Error(
      `LLM returned non-JSON (parse error: ${e?.message}): ${cleaned.slice(
        0,
        200
      )}`
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
    // Soft-correct rather than throw — language echo is informational,
    // the dialog_line is what matters and it'll be checked next.
    parsed.language = input.language;
  }

  // Guard the BM banned-token rule. If language=ms and any banned token
  // appears in dialog_line, reject so caller can surface a clean error.
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
