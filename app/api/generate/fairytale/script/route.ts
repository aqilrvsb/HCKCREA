import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orChat } from "@/lib/openrouter";

// POST /api/generate/fairytale/script
//
// Auto-generates a 10-scene fairytale script from a single user prompt.
// Each scene returns:
//   { narration: "...", image_prompt: "..." }
// Narration is short Bahasa Melayu (or English) ~12-20 words for one TTS clip.
// Image prompt is a vivid English description for the visual style requested
// — the wizard's selected visual style + tone shapes the prompt prefix.
//
// Returns: { ok: true, scenes: [...] } when complete.
// Frontend can poll /api/generate/fairytale/script-progress in future, but
// this v1 returns the full result synchronously (~5-15s OpenRouter call).

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Style = "storytelling" | "sharing" | "selling";
type Tone = "formal" | "happy" | "sad" | "scary" | "bold";
type Language = "ms" | "en";
type VisualStyle =
  | "realistic"
  | "3d"
  | "anime"
  | "fantasy"
  | "watercolor"
  | "noir"
  | "vintage"
  | "minimalist";

const STYLE_HINTS: Record<Style, string> = {
  storytelling: "Tell an engaging narrative story with a clear arc — setup, rising action, climax, resolution",
  sharing: "Share an interesting fact or experience as if telling a friend — conversational, informative",
  selling: "Build interest in a product or idea — hook, problem, solution, call to action",
};

const TONE_HINTS: Record<Tone, string> = {
  formal: "Use a measured, respectful, neutral tone",
  happy: "Use cheerful, upbeat, warm tone with light humor",
  sad: "Use melancholic, reflective, tender tone — slow pacing",
  scary: "Use suspenseful, mysterious, ominous tone — build dread",
  bold: "Use confident, energetic, punchy tone — short sharp lines",
};

const LANG_HINTS: Record<Language, string> = {
  ms: "Bahasa Melayu (Malaysian Malay) — natural casual phrasing, words like korang, aku, ni, tu, memang, je, dah",
  en: "English — natural conversational",
};

// Detailed visual hints — appended to every scene's image_prompt so the
// AI image model (RunningHub/Crun nano-banana) locks consistent style
// across all N scenes. Each hint specifies medium + palette + lighting
// + composition + reference style so the model has unambiguous targets.
const VISUAL_HINTS: Record<VisualStyle, string> = {
  realistic:
    "cinematic film still, 35mm anamorphic lens, teal-and-orange color grade, dramatic side lighting, shallow depth of field with creamy bokeh, painterly composition rule of thirds, atmospheric haze, modern blockbuster aesthetic, 4K detail",
  "3d":
    "Pixar-style 3D animated render, soft global illumination, expressive character with oversized eyes, warm saturated colors, subtle subsurface scattering on skin, plush fabrics, hero-pose composition, family-friendly Disney aesthetic",
  anime:
    "Studio Ghibli anime style by Hayao Miyazaki, soft watercolor backgrounds, warm pastel palette of cream/sage/sky-blue, expressive eyes with subtle highlights, lush hand-drawn detail, gentle whimsical atmosphere, painterly clouds",
  fantasy:
    "epic fantasy concept art, oil-painted texture, magical god-rays piercing the scene, rich jewel-tone palette of emerald/sapphire/gold, dramatic chiaroscuro, mythological grandeur, ArtStation trending, Frank Frazetta meets Greg Rutkowski",
  watercolor:
    "hand-painted watercolor illustration, soft bleeding edges, warm muted palette of cream/peach/sage, visible cold-press paper texture, gentle ink line work over wash, children's storybook aesthetic, dreamy light, Quentin Blake meets Beatrix Potter",
  noir:
    "cinematic film noir, high-contrast black-and-white with selective spot-color accent, dramatic single-source lighting, deep shadows with venetian-blind patterns, 1940s detective atmosphere, smoke and rain, low-angle dramatic composition, Sin City aesthetic",
  vintage:
    "vintage 1970s 35mm film photograph, warm sepia-and-amber color grade, visible film grain, light leaks at frame edges, faded contrast like aged Kodachrome, nostalgic documentary feel, sun-bleached palette, Wes Anderson meets old family album",
  minimalist:
    "editorial minimalist photography, clean negative space, single subject in sharp focus, soft natural window light, neutral palette of cream/charcoal/dove-grey, magazine-quality composition, premium fashion photography aesthetic, NYT Sunday Magazine feel",
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userPrompt = String(body?.prompt || "").trim().slice(0, 1000);
  const style = (["storytelling", "sharing", "selling"].includes(body?.style) ? body.style : "storytelling") as Style;
  const tone = (["formal", "happy", "sad", "scary", "bold"].includes(body?.tone) ? body.tone : "formal") as Tone;
  const language = (["ms", "en"].includes(body?.language) ? body.language : "ms") as Language;
  // Map legacy "nature" style (removed in favor of more distinct viral
  // styles) to "realistic" so any draft state in flight keeps working.
  const rawVisual = body?.visual_style === "nature" ? "realistic" : body?.visual_style;
  const visualStyle = (["realistic", "3d", "anime", "fantasy", "watercolor", "noir", "vintage", "minimalist"].includes(rawVisual)
    ? rawVisual
    : "realistic") as VisualStyle;
  const sceneCount = Math.max(3, Math.min(15, Number(body?.scene_count) || 10));
  const sceneDurationSec = Math.max(3, Math.min(20, Number(body?.scene_duration_sec) || 10));
  // CTA mode (3-way):
  //   • none       — story rides to its natural emotional close
  //   • engagement — AI ends with a topic-relevant comment-bait question
  //   • follow     — AI appends user's typed follow CTA verbatim (12-word cap)
  // Legacy support: body.cta === true (boolean) maps to "follow" so any
  // in-flight wizard state from the old UI still works.
  type CtaMode = "none" | "engagement" | "follow";
  let ctaMode: CtaMode = "none";
  if (body?.cta_mode === "engagement" || body?.cta_mode === "follow" || body?.cta_mode === "none") {
    ctaMode = body.cta_mode;
  } else if (body?.cta === true) {
    ctaMode = "follow";
  }
  // Cap to 12 words — count words, not chars, since user-typed CTAs
  // tend to be short imperatives ("Follow for daily story drops",
  // "Comment YES if you agree").
  const ctaWords = String(body?.cta_text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  const ctaText = ctaWords.join(" ");

  if (!userPrompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // Pace narration to fit the slide: MiniMax speech-2.6-turbo speaks BM at
  // ~2.7 words/sec and EN at ~3.0 words/sec. Compute a target word window
  // that lands at ~85-105% of the slide duration — under-fills leave dead
  // air at the end of the slide, over-fills run past the next slide.
  const wpsLow  = language === "ms" ? 2.5 : 2.8;
  const wpsHigh = language === "ms" ? 3.2 : 3.6;
  const lowWords  = Math.round(sceneDurationSec * wpsLow);
  const highWords = Math.round(sceneDurationSec * wpsHigh);
  const targetWords = `${lowWords}-${highWords}`;
  // Final-scene instruction varies by CTA mode. The instruction is
  // injected into the master system prompt below.
  let ctaInstruction: string;
  if (ctaMode === "follow" && ctaText) {
    ctaInstruction = `\nFINAL-SCENE CTA RULE (CRITICAL): Scene ${sceneCount} (the last scene) must END with this exact call-to-action woven naturally into the narration: "${ctaText}". Land the emotional resolution of the story FIRST in the same narration, THEN segue into the CTA. The CTA must feel like the natural reward for watching the story, not a tacked-on plug. Do not weaken or paraphrase the CTA — keep its core verbs ("follow", "comment", "share", whatever the user wrote) intact. The full last-scene narration should still be ${targetWords} words including the CTA portion.`;
  } else if (ctaMode === "engagement") {
    ctaInstruction = `\nFINAL-SCENE ENGAGEMENT-CTA RULE (CRITICAL): Scene ${sceneCount} (the last scene) must end with a SHORT, OPEN-ENDED QUESTION that bait viewers to comment with their answer or experience. The question must be specific to the story's TOPIC — not a generic "what do you think?". Examples of strong engagement questions for ${language === "ms" ? "Bahasa Melayu" : "English"}:
- "${language === "ms" ? "Korang pernah kena macam ni jugak? Drop dalam komen." : "Has this happened to you too? Drop it in the comments."}"
- "${language === "ms" ? "Apa korang akan buat kalau jadi dia? Comment bawah." : "What would you do in their shoes? Comment below."}"
- "${language === "ms" ? "Setuju ke tak setuju? Type 1 atau 2 dalam komen." : "Agree or disagree? Type 1 or 2 in the comments."}"
The story-close happens FIRST in the same narration, THEN the question — both fit within ${targetWords} words total. Make the question feel like a natural extension of the story, not a tacked-on prompt.`;
  } else {
    ctaInstruction = `\nFINAL-SCENE RULE: Scene ${sceneCount} (the last scene) must deliver the emotional payoff — the moment the viewer rewinds for, the line that makes them save the video or send it to a friend. Avoid weak filler endings like "Sekian" or "That's all". End with a feeling, a fact, or a question that lingers.`;
  }

  const systemPrompt = `You are an elite short-form-video story writer. You write the kind of scripts that make people stop scrolling, watch the full video, then follow the creator for more. Your scripts go viral because they hook fast, escalate emotionally, and reward attention.

OUTPUT FORMAT — STRICT:
- Output a JSON object: { "scenes": [ { "narration": "...", "image_prompt": "..." }, ... ] }
- Exactly ${sceneCount} scenes.
- Do NOT include any text other than the JSON. No markdown fences, no commentary.

NARRATION RULES:
- Each "narration" is ${language === "ms" ? "BAHASA MELAYU (Malaysian Malay), NOT Indonesian — natural casual phrasing, words like korang, aku, ni, tu, memang, je, dah" : "English — natural conversational"}.
- Each narration is **${targetWords} words** (this is critical — every scene plays for exactly ${sceneDurationSec} seconds of audio + Ken Burns motion, so under-${lowWords} words leaves dead air and over-${highWords} words forces TTS to rush past the next slide).
- Count your words for every narration before returning. Reject any scene outside ${targetWords} words and rewrite it.

VIRAL STORY STRUCTURE — APPLY ACROSS ALL ${sceneCount} SCENES:
- Scene 1 = HOOK. Open with a curiosity gap, shocking fact, bold claim, or unexpected question. Make scrolling impossible. Examples that work: "Tahu tak satu fakta gila pasal X yang ramai tak perasan?" / "I almost didn't survive what happened next." Bad: "Hari ini saya nak cerita…" (boring, gets scrolled past).
- Scenes 2-3 = AGITATE. Deepen the curiosity. Add a specific detail, a number, a name, a vivid sensory image. Make the viewer FEEL invested.
- Middle scenes = ESCALATE. Each scene raises the stakes or the surprise factor. End each middle scene on a small cliffhanger ("…tapi yang lagi pelik…", "…and then we noticed something") so the viewer needs the next slide to resolve it.
- Last 2 scenes = PAYOFF. Deliver the resolution, the answer, the "aha". Reward the viewer's attention with a real beat — emotional, factual, or both.${ctaInstruction}

ENGAGEMENT TECHNIQUES — USE LIBERALLY:
- Specific numbers > vague claims. "3 saat" beats "cepat". "RM 2,847" beats "banyak duit".
- Sensory details > abstract description. "Bau hangit" / "tangan menggeletar" > "perasaan tak best".
- Pattern interrupts: short punchy sentence after a longer one. Or a one-word scene if the punch lands.
- Stakes — make the viewer care WHY this matters to them, not just to the character.
- Avoid filler: "ramai orang", "macam-macam", "pelbagai", "etc". Pick ONE concrete example instead.

STYLE: ${STYLE_HINTS[style]}.
TONE: ${TONE_HINTS[tone]}.

IMAGE PROMPT RULES:
- Each "image_prompt" is in ENGLISH, 30-60 words.
- Structure: subject + action + setting + atmosphere + lighting + camera angle.
- Show the EMOTION of the scene's narration moment, not just literal objects. If the narration is shocking, the image should feel charged. If reflective, the image should feel still.
- Always END the image_prompt with: "${VISUAL_HINTS[visualStyle]}"
- For 9:16 vertical video, frame composition vertically — main subject in upper-third, environment context in lower-thirds.

Generate the JSON now. The viewer should still be watching at scene ${sceneCount}.`;

  const userMsg = `Story prompt: ${userPrompt}

Generate the JSON now.`;

  const result = await orChat({
    systemPrompt,
    userPrompt: userMsg,
    temperature: 0.85,
    maxTokens: 4500,
  });

  if (!result.ok || !result.content) {
    return NextResponse.json(
      { error: result.error || "Script generation failed" },
      { status: 502 }
    );
  }

  // Parse — strip markdown fences if model added them despite instructions
  let raw = result.content.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some models prepend text — try to find the first { and last } and parse that slice
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        return NextResponse.json(
          { error: "AI returned invalid JSON", raw: raw.slice(0, 300) },
          { status: 502 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw: raw.slice(0, 300) },
        { status: 502 }
      );
    }
  }

  const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (scenes.length === 0) {
    return NextResponse.json(
      { error: "AI returned empty scenes array" },
      { status: 502 }
    );
  }

  // Sanitize — coerce to expected shape, drop garbage
  const cleaned = scenes
    .filter((s: any) => s && typeof s === "object")
    .map((s: any, i: number) => ({
      idx: i,
      narration: String(s.narration || s.text || "").trim().slice(0, 400),
      image_prompt: String(s.image_prompt || s.imagePrompt || s.image || "").trim().slice(0, 800),
    }))
    .filter((s: any) => s.narration && s.image_prompt);

  return NextResponse.json({
    ok: true,
    scenes: cleaned,
    style,
    tone,
    language,
    visual_style: visualStyle,
  });
}
