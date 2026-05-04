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
type VisualStyle = "realistic" | "3d" | "fantasy" | "minimalist" | "nature" | "anime";

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

const VISUAL_HINTS: Record<VisualStyle, string> = {
  realistic: "photorealistic cinematic photography, natural lighting, shallow depth of field, 4K detail",
  "3d": "stylized 3D animated render, Pixar-style lighting, soft shadows, vibrant colors",
  fantasy: "fantasy concept art, epic painterly style, magical lighting, rich saturated colors, dreamlike atmosphere",
  minimalist: "minimalist composition, clean background, single subject focus, soft pastels, simple framing",
  nature: "natural landscape photography, golden hour lighting, atmospheric, scenic vista",
  anime: "Japanese anime art style, expressive character design, vibrant cel-shaded coloring, dynamic angles",
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
  const visualStyle = (["realistic", "3d", "fantasy", "minimalist", "nature", "anime"].includes(body?.visual_style) ? body.visual_style : "realistic") as VisualStyle;
  const sceneCount = Math.max(3, Math.min(15, Number(body?.scene_count) || 10));
  const sceneDurationSec = Math.max(3, Math.min(20, Number(body?.scene_duration_sec) || 10));

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
  const systemPrompt = `You are a story script writer for short-form video. You produce scene-by-scene scripts where each scene is exactly one short sentence of narration plus a vivid image generation prompt.

OUTPUT RULES — STRICT:
- Output a JSON object: { "scenes": [ { "narration": "...", "image_prompt": "..." }, ... ] }
- Exactly ${sceneCount} scenes.
- Each "narration" is ${language === "ms" ? "BAHASA MELAYU (Malaysian Malay), NOT Indonesian" : "English"}, **${targetWords} words** (this is critical — every scene plays for exactly ${sceneDurationSec} seconds of audio + Ken Burns motion, so under-${lowWords} words leaves dead air at the end of the slide and over-${highWords} words forces the TTS to rush past the next slide).
- Each "image_prompt" is in ENGLISH, 30-60 words, vivid visual description with subject + setting + atmosphere + lighting. Always END the image_prompt with: "${VISUAL_HINTS[visualStyle]}"
- Story arc must be coherent across the ${sceneCount} scenes — beginning, middle, end.
- ${STYLE_HINTS[style]}.
- ${TONE_HINTS[tone]}.
- Language for narration: ${LANG_HINTS[language]}.
- Count your words for every narration before returning. Reject any scene shorter than ${targetWords.split("-")[0]} words and rewrite it longer.
- Do NOT include any text other than the JSON. No markdown fences, no commentary.`;

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
