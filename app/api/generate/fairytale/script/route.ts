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
type Tone = "auto" | "formal" | "happy" | "sad" | "scary" | "bold";
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

// Tone is now AI-decided — the LLM reads the user's prompt and picks
// the mood (sad / suspenseful / happy / etc) that fits. The legacy
// keys remain accepted for backward compat with old draft state, but
// "auto" is the canonical signal that tells the prompt to stop
// imposing tone constraints.
const TONE_HINTS: Record<Tone, string> = {
  auto: "Read the user's prompt carefully and choose the SINGLE tone that best fits the story (suspenseful, melancholic, joyful, ominous, tender, etc). Commit to that tone fully across all scenes — no mood-mixing within one story.",
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

// Per-style suffix appended to every scene's image_prompt. Tuned for
// nano-banana / Gemini 2.5 Flash Image based on Google's official
// guide and community research: real camera/lens names beat empty
// adjectives; semantic negatives + "no text, no watermark" inline;
// named lighting (key+fill+color temp) instead of "cinematic look".
const VISUAL_HINTS: Record<VisualStyle, string> = {
  realistic:
    "Shot on ARRI Alexa with 40mm anamorphic lens at f/1.8, oval bokeh, subtle horizontal lens flare. Color graded with teal shadows and warm-orange highlights, lifted blacks. Hard side key light, soft bounce fill, atmospheric haze with visible god-rays. Composition rule of thirds, deep negative space. Avoid: plastic skin, extra fingers, modern signage, watermark, captions, rendered text.",
  "3d":
    "3D animated feature-film render in the warmth of a Pixar / DreamWorks production. Subsurface-scattering skin, large expressive eyes, plush fabric folds, hand-painted PBR textures. Three-point softbox lighting with warm rim light, soft global illumination. Family-film color palette, shallow depth of field. Avoid: stiff CGI plastic, dead eyes, watermark, captions, rendered text.",
  anime:
    "Hand-painted anime background in the feel of a Studio Ghibli (Hayao Miyazaki) film. Watercolor wash on textured paper, gouache cloud rendering, gentle cel-shaded characters, soft natural light filtering through foliage, dust motes in sunlight, muted pastel palette of cream / sage / sky-blue. Avoid: digital airbrush gloss, anime-fan-art over-rendering, watermark, captions, rendered text.",
  fantasy:
    "Epic fantasy matte painting, oil-on-canvas brushwork, low-angle hero shot. Volumetric god-rays through ancient arches, painterly chiaroscuro, ember particles drifting through air. Desaturated palette with a single accent color (emerald, sapphire, or gold). 50mm lens compression, ArtStation-trending feel of Frank Frazetta meets Greg Rutkowski. Avoid: generic dragon-slayer kitsch, AI-poster sheen, watermark, captions, rendered text.",
  watercolor:
    "Traditional watercolor illustration on cold-press paper. Visible paper grain, wet-on-wet bleeding edges, soft pigment pooling, hand-drawn graphite underline, white paper used as negative space. Limited 4-color palette of cream / peach / sage / soft pink. Storybook feel of Quentin Blake meets Beatrix Potter. Avoid: digital airbrush, vector smoothness, watermark, captions, rendered text.",
  noir:
    "Black-and-white film noir still, hard venetian-blind shadow patterns slicing across the subject. Single tungsten key light from low angle, deep silver highlights, bleach-bypass contrast. 1940s Kodak Tri-X grain, smoke-filled air, Dutch tilt. Single accent color allowed (red rose, neon sign). Avoid: generic black-and-white filter look, watermark, captions, rendered text.",
  vintage:
    "1970s Kodak Portra 400 film still, warm magenta cast, soft halation around highlights, fine organic grain, slightly faded blacks, light leak in upper-right corner. 50mm prime lens at f/2 photographed on a Pentax K1000. Sun-bleached palette with Wes Anderson symmetry, old-family-album mood. Avoid: digital sharpness, modern signage, watermark, captions, rendered text.",
  minimalist:
    "High-fashion editorial photograph, Vogue / NYT Sunday Magazine composition. Beauty-dish key light with subtle clamshell fill, large negative space, glossy magazine paper feel. Shot on Hasselblad medium format, 80mm lens at f/4, neutral palette of cream / charcoal / dove-grey. Avoid: cluttered staging, stock-photo blandness, watermark, captions, rendered text.",
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
  // Tone defaults to "auto" — UI no longer exposes the picker, AI infers
  // mood from the user's prompt. Old explicit values still accepted for
  // any draft state in flight.
  const tone = (["auto", "formal", "happy", "sad", "scary", "bold"].includes(body?.tone) ? body.tone : "auto") as Tone;
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

  const systemPrompt = `You are a TikTok-native scriptwriter. Your scripts go viral because they're written like a person texting their best friend at 2am — fast, simple, plot-clear, emotion-loud. They are NOT short films. They are NOT cinematic monologues. They are TikToks. The 1.5-second swipe rule decides everything.

OBJECTIVE: keep a Malaysian TikTok viewer watching to the end. The audience speaks Bahasa Melayu and English fluently and watches a wide range of topics — personal stories, biographies of foreign figures, history, science, finance, sports, conspiracy theories, anything. DO NOT force every story into a Malaysian-village setting. The story content is whatever the user's prompt dictates — your job is to make THAT story land for a Malaysian viewer.

OUTPUT FORMAT — STRICT:
- Output a JSON object: { "scenes": [ { "narration": "...", "image_prompt": "..." }, ... ] }
- Exactly ${sceneCount} scenes.
- No markdown fences, no commentary. JSON only.

══════════════════════════════════════════════════════════════════
THE TIKTOK PACE TEST (every scene must pass)
══════════════════════════════════════════════════════════════════

Before keeping a sentence, ask:
  1. Would a 16-year-old understand this on FIRST listen?
  2. Does this scene MOVE THE PLOT or REVEAL EMOTION? (If only "sets atmosphere" → DELETE.)
  3. If I read this with no context, do I know WHO the speaker is and WHAT they want?
  4. Would the viewer swipe? If unsure → make it punchier.

Fail any → rewrite. Two failures across the whole story → start over.

══════════════════════════════════════════════════════════════════
NARRATION RULES
══════════════════════════════════════════════════════════════════

LANGUAGE: ${language === "ms"
    ? `BAHASA MELAYU — Malaysian SPOKEN register, NOT Indonesian, NOT formal Berita-style.
   Use freely: aku, korang, kitorang, je, dah, ni, tu, kan, lah, weh, memang, jom, kena, tak, gerak, nampak, mula-mula, last-last, taknak, takleh.
   FORBIDDEN (sounds Indonesian or AI): banget, gue, lo, deh, sih, kok, loh, aja, butuh, menyelami, permaidani, perjalanan emosi.
   FORBIDDEN literary metaphor patterns (bau "menyengat", peluh "meresap", dakwat "pudar", suara "bergema", angin "mendesah"). These read as AI-poetry, not human speech.
   Texting a friend, you don't describe smells. You go to what HAPPENED.`
    : `ENGLISH — natural conversational, first-person preferred for personal stories. Texting-a-friend register, not novel-writing.
   FORBIDDEN literary tropes: "the air thick with X", "she could feel the Y", "the silence stretched between them".`}

WORD COUNT: Each narration is **${targetWords} words** (audio plays ${sceneDurationSec}s at 1.2x; under-${lowWords} = dead air, over-${highWords} = rushed). Count before returning.

ONE-IDEA-PER-SCENE RULE (the most important):
- Each scene contains EXACTLY ONE plot beat OR one emotional beat. Not two. Not "atmosphere + plot". Not "sensory detail + reveal".
- BAD pattern: "[time of day] di [named place], bau [thing] menyengat [body part]" → multiple ideas, viewer brain stalls.
- GOOD pattern: ONE clear action or emotion that moves the story forward.

PLAIN-LANGUAGE FILTER:
- After writing each line, replace the fanciest word with the simplest equivalent.
- Power verbs (clear actions) yes. POETIC verbs (atmosphere only) no.

SENSORY DETAIL — USE SPARINGLY (max 1 per STORY):
- A single sensory detail at the right beat = high-impact.
- Two sensory details in the same scene = literary mush.
- Default: skip the smell/texture/temperature stuff. Lead with WHAT HAPPENED.

SHOW EMOTION — DIRECT IS FINE:
- Once across the whole story, you may use a body-language line. Just once.
- Otherwise state the emotion directly. "Aku terkejut" / "I froze" beats three lines of physical-symptom poetry.

SPECIFICITY — BRIEF:
- ONE specific number across the whole story (the most plot-relevant one).
- ONE named place if it's plot-critical.
- Power verbs > adjective stacks.

══════════════════════════════════════════════════════════════════
VIRAL STRUCTURE — TikTok pace, applied across ${sceneCount} scenes
══════════════════════════════════════════════════════════════════

SCENE 1 (HOOK, ${Math.max(6, Math.round(lowWords * 0.6))}–${Math.round(lowWords * 0.9)} words).
The hook depends on the topic. Pick the formula that fits:
  • Confession with stakes (personal stories): "I lost [X] because I [trusted/believed/missed] [Y]."
  • Mid-action drop (story): "I was [doing X], when [Y happened]."
  • Stat punch (educational / list / fact-based): "9 out of 10 people get [topic] wrong."
  • Bold contrarian (opinion / advice): "Everyone says [X]. They're wrong, and here's why."
  • Curiosity gap (mystery / biography / event): "What [person/thing] did next still doesn't make sense."

The hook MUST be plot-clear. Viewer should know in 3 seconds whether to keep watching.

BANNED OPENERS (instant scroll, regardless of language or topic):
"Once upon a time...", "Today I want to tell you a story...", "In a world where...", "Imagine if...", "Little did they know...", any weather / time-of-day / smell-based opener that comes BEFORE the action.

SCENES 2–3 (SITUATION — make it CLEAR). By end of scene 3 the viewer must know:
  • WHO the subject is
  • WHAT happened / is about to happen
  • WHY it matters (stakes — emotional, financial, relational, historical, whatever the topic supplies)
No atmosphere build-up. Plot first.

MIDDLE SCENES (ESCALATE — one beat per scene). Each middle scene = ONE new development that raises the stakes. End each on a tiny cliffhanger that opens a Zeigarnik loop ("but the next part is what shocked everyone", "and that's when [subject] noticed something off"). DESCRIBE LESS, REVEAL MORE.

SCENE ${sceneCount - 1} (THE TWIST / REVEAL). One line. Clear. The "OH" moment. No flowery lead-in.

SCENE ${sceneCount} (PAYOFF). The takeaway viewers screenshot or share. Plain language. ${ctaMode === "follow" ? "" : "Land the emotional close FIRST, THEN open a soft loop or question."}${ctaInstruction}

══════════════════════════════════════════════════════════════════
BANNED WORDS / PHRASES (immediate fail — rewrite the line)
══════════════════════════════════════════════════════════════════

ENGLISH (Wikipedia "Signs of AI writing" + community ban lists):
delve, tapestry, testament, pivotal, crucial, landscape, realm, journey, harness, leverage, unlock, robust, seamless, vibrant, intricate, nuanced, holistic, transformative, ethereal, resonance, ephemeral, paradigm, synergy, framework, dynamic, comprehensive, profound, groundbreaking, cutting-edge, revolutionize, multifaceted, underscore, showcase, foster, boast, navigate, embark, mosaic, symphony, labyrinth, crescendo, flicker, "heart pounded".

PHRASE PATTERNS (banned regardless of language):
"It's not X — it's Y", "In a world where", "Most people X. The few who Y", "Stop doing X, start doing Y", "Imagine if", "Little did they know", "At the end of the day", "Here's the truth nobody tells you".

CLOSERS (banned): "In summary", "In conclusion", "${language === "ms" ? "Akhir kata" : "And that's the end"}", "${language === "ms" ? "Pada akhirnya" : "In closing"}", "${language === "ms" ? "Sekian" : "That's all"}".

${language === "ms" ? `BM SPECIFIC (sounds AI / sounds Indonesian):
menyelami, permaidani kehidupan, perjalanan yang penuh makna, butuh, banget, gue, lo.` : ""}

══════════════════════════════════════════════════════════════════
TONE
══════════════════════════════════════════════════════════════════

${TONE_HINTS[tone]}

══════════════════════════════════════════════════════════════════
IMAGE_PROMPT RULES (these become nano-banana inputs — 9:16 vertical)
══════════════════════════════════════════════════════════════════

VISUAL TRUTH-TO-TOPIC RULE (the only rule for ethnicity, setting, props):

Read the user's story prompt. Ask: "If a Malaysian TikTok viewer sees these images, will they believe this story IS what the prompt says it is?" That's the test. The visuals must serve the topic, not a fixed locale.

How to decide:
1. If the prompt names a real person, place, era, or culture (e.g. Elon Musk in California, samurai in Edo-period Japan, fisherman in Terengganu, K-pop trainee in Seoul) → portray that subject AUTHENTICALLY. Real face, real costume, real backdrop. Forcing the wrong locale here breaks viewer trust faster than anything else.
2. If the prompt is a generic / personal / fictional story with no named foreign subject (e.g. "story about a young man losing money", "kisah seorang ibu") → set it in the world that feels CLOSEST and most believable to a Malaysian audience. That usually means Malaysian / Southeast Asian context, but only because that's what feels real to them — NOT because we're forcing it. Apply this only when the prompt doesn't dictate otherwise.
3. When in doubt, default to whatever world the prompt's NOUNS imply (a story mentioning bengkel + kapcai → Malaysian; a story mentioning Wall Street + yellow cab → American; a story mentioning ramen shop + Shibuya → Japanese).

CHARACTER TRAIT LOCK (works for any locale):
Whatever ethnicity / age / build / clothing you decide for the protagonist, write it as ONE descriptive phrase and PASTE IT VERBATIM into every scene's image_prompt. Never paraphrase, never vary the wording — even small wording changes make nano-banana drift the face. Format example only (substitute your own decision):
"a [age]-year-old [ethnicity / nationality] [man / woman / child], [skin tone], [hair colour + style], [eye colour + shape], wearing [outfit description]"

DEFAULT-AVOID LIST (applies regardless of topic — these are AI-stink defaults, not locale rules):
- No blue eyes / blonde hair on a character whose prompt doesn't call for them. Models default to Anglo-Caucasian features even on stories that don't ask for it; correct this by writing the right ethnicity into your TRAIT LOCK.
- No generic "modern city" backdrop when the story has a specific implied setting. Pick a real-feeling location.
- No rendered text, captions, watermarks. Add these to every scene's "Avoid:" list.

Each "image_prompt" follows the verb-first sentence structure that nano-banana (Gemini 2.5 Flash Image) responds to. NOT a keyword salad — narrative sentences with real photographic vocabulary.

TEMPLATE (70–130 words — Malaysian clamp adds ~15 words vs generic):
[Shot type / strong verb] of [TRAIT LOCK — paste the Malaysian character description verbatim].
[Action verb] in [Malaysian setting from list above + time of day + atmosphere].
Lit with [key + fill light + color temperature — humid tropical light is warmer + softer than European overcast].
Captured on [camera/lens + f-stop OR film stock].
Composition: [framing rule, negative space, where the subject sits in the 9:16 frame].
Avoid: no text overlay, no watermark, no extra fingers, no plastic skin, no Western Caucasian features, no New York / Los Angeles backdrop.
Then append the style block: "${VISUAL_HINTS[visualStyle]}"

CRITICAL nano-banana rules:
1. Verb-first opener ("Cinematic medium close-up of...", "Hand-painted watercolor of..."). Never start with an article.
2. Use real camera/lens names (ARRI Alexa, 40mm anamorphic, 85mm portrait at f/1.8) — not "professional camera" or "high quality".
3. Repeat the TRAIT LOCK verbatim across all ${sceneCount} scenes — same skin tone, hair, eyes, outfit. Copy-paste; do not paraphrase. This is how nano-banana keeps the same person AND same ethnicity across 10 images.
4. Use semantic negatives ("empty kedai mamak" not "no people"). Always add: "no text, no watermark, no captions, no Western Caucasian features".
5. For 9:16 vertical, place the subject in the upper-two-thirds, leave headroom for caption overlay area.
6. Show the EMOTION of the moment via Malaysian body language — head-shake, jari-tunjuk, hand on chest, salam, slow nod. Not Hollywood gestures.

Generate the JSON now. The viewer must still be watching at scene ${sceneCount}, AND the post-watch comment section must light up.`;

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
