import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orChat } from "@/lib/openrouter";
import { getSetting, getP2Config } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { createAdminClient } from "@/lib/supabase/admin";

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
  auto: "Read the user's prompt carefully and choose the SINGLE tone that best fits the story. Pick from the WIDE register a TikTok viewer responds to — not just literary moods. Options include: suspenseful, melancholic, joyful, ominous, tender, playful, deadpan, outraged, hyped, sarcastic, awe-struck, conspiratorial, savage, fed-up, in-disbelief. Commit to that tone fully across all scenes — no mood-mixing within one story.",
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
    "Shot on ARRI Alexa with 40mm anamorphic lens at f/1.8, oval bokeh, subtle horizontal lens flare. Color graded with teal shadows and warm-orange highlights, lifted blacks. Hard side key light, soft bounce fill, crisp atmosphere. Composition rule of thirds, clean negative space. Avoid: plastic skin, extra fingers, modern signage, watermark, captions, rendered text.",
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
  // ~2.7 words/sec and EN at ~3.0 words/sec. We RESERVE a 1-second tail
  // at the end of every slide so the visual transition (fade / slide /
  // wipe) has room to breathe and the viewer's brain registers the
  // beat before the next scene lands. Without this tail the cut feels
  // jolting — audio ends and the next slide arrives in the same frame.
  // Modal's min_duration floor (= sceneDurationSec) automatically pads
  // the merged MP4 with silence, so all we need to do here is shorten
  // the SPEECH target. Audio = (sceneDurationSec - SCENE_TAIL_SEC).
  const SCENE_TAIL_SEC = 1.0;
  const speechSec = Math.max(2, sceneDurationSec - SCENE_TAIL_SEC);
  const wpsLow  = language === "ms" ? 2.5 : 2.8;
  const wpsHigh = language === "ms" ? 3.2 : 3.6;
  const lowWords  = Math.round(speechSec * wpsLow);
  const highWords = Math.round(speechSec * wpsHigh);
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
- Output a JSON object: { "main_character": "...", "scenes": [ { "narration": "...", "image_prompt": "..." }, ... ] }
- Exactly ${sceneCount} scenes.
- No markdown fences, no commentary. JSON only.

MAIN CHARACTER — REQUIRED:
- Identify the SINGLE protagonist who appears in MOST scenes (typically scenes 2-N — the person/animal/creature/object the story follows). This becomes the "reference character" that anchors every scene image for visual consistency.
- main_character: ONE detailed visual sentence (40-80 words) capturing the protagonist's APPEARANCE — type (person / animal / object / creature), age if person, gender if relevant, distinctive features (beard, hijab, costume colors, build, eye color, fur, material, era of clothing). Be specific enough that the image model can render the same character identically across multiple scenes.
- Examples:
  • Person: "An elderly Malay man in his 70s with full grey beard, weathered tanned skin, kind brown eyes, wearing traditional dark navy baju Melayu with embroidered collar, gentle calm expression, slightly hunched posture."
  • Animal: "A small grey tabby cat with bright emerald-green eyes, tufted ears, white chest patch, slender build, alert expression, soft fluffy tail."
  • Object: "An ancient brass tea kettle with curved golden spout, patinated copper body engraved with arabesque patterns, ornate wooden handle, slight green oxidation."
- If the story has NO single recurring character (pure landscape montage, ensemble cast with no clear lead, abstract concept), set main_character to empty string ("") and the system will fall back to text-only scene generation.

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

WORD COUNT: Each narration is **${targetWords} words**. Speech runs ~${speechSec}s at 1.2x, then ${SCENE_TAIL_SEC}s of natural silence lets the visual transition breathe before the next slide. Total slide = ${sceneDurationSec}s. Under-${lowWords} = dead air, over-${highWords} = audio bleeds into the next scene. Count before returning.

ONE-IDEA-PER-SCENE RULE (the most important):
- Each scene contains EXACTLY ONE plot beat OR one emotional beat. Not two. Not "atmosphere + plot". Not "sensory detail + reveal".
- BAD pattern: "[time of day] di [named place], bau [thing] menyengat [body part]" → multiple ideas, viewer brain stalls.
- GOOD pattern: ONE clear action or emotion that moves the story forward.

PLAIN-LANGUAGE FILTER:
- After writing each line, replace the fanciest word with the simplest equivalent.
- Power verbs (clear actions) yes. POETIC verbs (atmosphere only) no.

SPECIFICITY BUDGET — read the topic, then pick the right rule:

  • DATA-DRIVEN topics (finance, science, history, sports stats, geopolitics, true-crime numbers, biographies of named figures): NUMBERS ARE THE PLOT. Use as many specific figures as the topic demands — that's what makes a finance / history / science explainer credible. Don't artificially cap.
  • PERSONAL / EMOTIONAL / FICTIONAL stories (the typical kampung tale, breakup story, dream sequence): cap at 2 specifics across the WHOLE story. Pick from this menu:
      - one sensory detail (smell / sound / texture / temperature) at a high-impact beat
      - one specific number (the most plot-relevant figure)
      - one named place if plot-critical
      - one body-language emotion line ("tangan gemetar" / "I froze")
    Two slots used = budget spent. Anything else = state directly.

WHY the cap exists for personal stories: four specifics at once = literary mush. Two = anchored without bloat.

POWER VERBS over adjective stacks. POETIC verbs only when they describe a clear action (yes "menerkam"; no "mendesah").

NARRATOR vs SUBJECT VOICE (critical for foreign / historical / biographical topics):
You are the NARRATOR retelling this story to a Malaysian friend at 2am — not the subject themselves.
  • Foreign / historical characters never speak BM slang in their dialog. Either quote them in their actual language briefly, OR summarise in your narrator voice ("dia cakap Apple ni akan ubah dunia").
  • The casual "korang / weh / lah" / "lowkey / kinda" register belongs to YOU narrating, NOT to Steve Jobs's mouth, NOT to a samurai's mouth, NOT to a Tokyo chef's mouth.
  • Foreign proper nouns (people, places, products, eras) stay INTACT — do not localize. "Steve Jobs", "1976", "Cupertino", "Apple I", "Wall Street", "Tokyo Shibuya", "World War 2" all stay as-is. Narration LANGUAGE stays ${language === "ms" ? "BM" : "EN"}; SUBJECT MATTER stays topic-authentic.
  • Biographies and history still hit the TikTok pace test — never Wikipedia tone.

══════════════════════════════════════════════════════════════════
VIRAL STRUCTURE — TikTok pace, applied across ${sceneCount} scenes
══════════════════════════════════════════════════════════════════

SCENE 1 (HOOK, ${targetWords} words — same length as body scenes so TTS audio fills the ${sceneDurationSec}s slide cleanly). The PUNCH lives in the FIRST ${Math.max(4, Math.round(lowWords * 0.4))}–${Math.round(lowWords * 0.6)} words; the rest of the line is a specifying detail that earns the curiosity. Don't shorten the line — load the impact upfront then add the anchor.
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

SCENE ${sceneCount} (PAYOFF). The takeaway viewers screenshot or share. Plain language.${ctaInstruction}

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

🎯 IMAGE-NARRATION COHERENCE RULE (the most-violated rule — read twice):
Before writing each image_prompt, identify the ONE concrete NOUN and ONE concrete VERB in THAT scene's narration. The image MUST depict that exact noun performing that exact verb. Atmosphere supports the verb; atmosphere does NOT replace it.

  • Narration says "dia hempas keyboard" → image shows the character actively SLAMMING the keyboard, mid-motion, fingers blurred. NOT "man at desk looking frustrated".
  • Narration says "Steve held the first Apple I prototype" → image shows hands cradling a circuit board. NOT "Steve thinking in a garage".
  • Narration says "the samurai sheathed his sword" → image shows the blade mid-slide into the saya. NOT "samurai standing solemnly at sunset".

If the narration is internal/reflective (no concrete verb), invent a matching physical action that visualizes the thought ("realized he was wrong" → image of the character pausing, looking at a specific object that triggered the realization). Never default to "person looking pensive at camera".

TEMPLATE (70–130 words):
[Shot type / strong verb] of [TRAIT LOCK — paste verbatim].
[Action verb] in [setting that fits the story's topic + time of day + atmosphere].
Lit with [lighting that matches the implied setting + time of day + color temperature].
Captured on [camera/lens + f-stop OR film stock].
Composition: [framing rule, negative space, where the subject sits in the 9:16 frame].
Avoid: no text overlay, no watermark, no extra fingers, no plastic skin, no features that contradict the TRAIT LOCK, no backdrop that contradicts the implied setting.
Then append the style block: "${VISUAL_HINTS[visualStyle]}"

CRITICAL nano-banana rules:
1. Verb-first opener ("Cinematic medium close-up of...", "Hand-painted watercolor of..."). Never start with an article.
2. Use real camera/lens names (ARRI Alexa, 40mm anamorphic, 85mm portrait at f/1.8) — not "professional camera" or "high quality".
3. Repeat the TRAIT LOCK verbatim across all ${sceneCount} scenes — same skin tone, hair, eyes, outfit. Copy-paste; do not paraphrase. This is how nano-banana keeps the same person AND same ethnicity across all ${sceneCount} images.
4. Use semantic negatives ("empty [location]" not "no people"). Always add: "no text, no watermark, no captions" — never bake locale-specific avoids into this list.
5. For 9:16 vertical, place the subject in the upper-two-thirds, leave headroom for caption overlay area.
6. Show emotion via body language that fits the character's culture and era. Avoid generic stock poses; use the gestures a real person from THAT culture/era would actually use.
7. VARY shot types across the ${sceneCount} scenes — wide establishing, medium two-shot, close-up, insert (hands / object), over-shoulder, low-angle. Same-frame fatigue kills retention.

Generate the JSON now. The viewer must still be watching at scene ${sceneCount}, AND the post-watch comment section must light up.`;

  const userMsg = `Story prompt: ${userPrompt}

Generate the JSON now.`;

  // ─── Validation helpers ──────────────────────────────────────────
  // Banned-word list = the same regex patterns the prompt forbids,
  // so server-side enforcement matches what the LLM was told. We don't
  // run this on the image_prompt (the visual hints intentionally use
  // some flagged words like "ethereal" for the fantasy style).
  const BANNED_NARRATION_REGEX = [
    /\bdelve\b/i, /\btapestry\b/i, /\btestament\b/i, /\bpivotal\b/i,
    /\bharness\b/i, /\bleverage\b/i, /\bunlock(?:s|ed|ing)?\b/i,
    /\brobust\b/i, /\bseamless\b/i, /\bvibrant\b/i, /\bintricate\b/i,
    /\bnuanced\b/i, /\bholistic\b/i, /\btransformative\b/i,
    /\bparadigm\b/i, /\bsynergy\b/i, /\bunderscore(?:s|d)?\b/i,
    /\bshowcase(?:s|d)?\b/i, /\bnavigate(?:s|d)?\b/i, /\bembark(?:s|ed)?\b/i,
    /\bcrescendo\b/i, /\bmosaic\b/i, /\bsymphony\b/i, /\blabyrinth\b/i,
    /menyelami/i, /permaidani/i, /perjalanan emosi/i,
    /menyengat/i, /\bmeresap\b/i, /\bmendesah\b/i,
    /^pada zaman dahulu/i, /^once upon a time/i,
    /^in a world where/i, /^imagine if\b/i,
    /\bsekian\b/i, /\bakhir kata\b/i,
    /\bin conclusion\b/i, /\bin summary\b/i,
  ];
  function countWords(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length;
  }
  function violatesBudget(narration: string): string | null {
    const wc = countWords(narration);
    if (wc < lowWords) return `too short (${wc} words, need ${targetWords})`;
    if (wc > highWords + 2) return `too long (${wc} words, need ${targetWords})`;
    for (const re of BANNED_NARRATION_REGEX) {
      const m = narration.match(re);
      if (m) return `banned phrase "${m[0]}"`;
    }
    return null;
  }

  // ─── First call ──────────────────────────────────────────────────
  // Storytelling has its OWN model setting (storytelling_script_model)
  // independent from model_auto so admin can use a stronger JSON
  // producer here without making Auto Content's master plan more
  // expensive. Empty → falls back to model_auto via orChat's default
  // modelKey="model_auto", preserving backward compat.
  const scriptModelSetting = await getSetting<{ model: string }>(
    "storytelling_script_model"
  );
  const dedicatedModel = scriptModelSetting?.model?.trim();
  let result = await orChat({
    systemPrompt,
    userPrompt: userMsg,
    temperature: 0.85,
    maxTokens: 4500,
    ...(dedicatedModel ? { modelOverride: dedicatedModel } : {}),
  });

  if (!result.ok || !result.content) {
    return NextResponse.json(
      { error: result.error || "Script generation failed" },
      { status: 502 }
    );
  }

  // Parse — strip markdown fences if model added them despite instructions
  function tryParse(text: string): any | null {
    let raw = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(raw); } catch {}
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
    }
    return null;
  }

  let parsed = tryParse(result.content);
  if (!parsed) {
    return NextResponse.json(
      { error: "AI returned invalid JSON", raw: result.content.slice(0, 300) },
      { status: 502 }
    );
  }

  // ─── Server-side validation pass ─────────────────────────────────
  // Count violations against the prompt's own rules. If too many
  // scenes drift, retry ONCE with a corrective system message naming
  // the violators. Single retry caps cost — the user pays for at most
  // 2 OpenRouter calls per Generate click.
  function findViolations(scenesArr: any[]): { idx: number; reason: string }[] {
    if (!Array.isArray(scenesArr)) return [];
    return scenesArr
      .map((s: any, i: number) => {
        const narr = String(s?.narration || s?.text || "").trim();
        if (!narr) return null;
        const reason = violatesBudget(narr);
        return reason ? { idx: i, reason } : null;
      })
      .filter(Boolean) as { idx: number; reason: string }[];
  }

  let scenesRaw = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  let violations = findViolations(scenesRaw);

  // > 1 violations across the story = drift; retry with a correction.
  // 0–1 violations are within tolerance (the LLM's not perfect, and
  // strict retries on single drifts blow the cost budget).
  if (violations.length > 1) {
    const violationList = violations
      .map((v) => `  • Scene ${v.idx + 1}: ${v.reason}`)
      .join("\n");
    const correction = `${systemPrompt}

══════════════════════════════════════════════════════════════════
CORRECTION PASS — your previous attempt failed validation:
${violationList}

Regenerate the FULL JSON. Specifically:
- Every narration must be ${targetWords} words.
- Strip the flagged banned phrases above; rewrite those scenes in plain conversational language.
- Same TRAIT LOCK, same story, same scene count. Just fix the violations.`;

    const retry = await orChat({
      systemPrompt: correction,
      userPrompt: userMsg,
      temperature: 0.7, // lower temp on retry — more compliant
      maxTokens: 4500,
      ...(dedicatedModel ? { modelOverride: dedicatedModel } : {}),
    });
    if (retry.ok && retry.content) {
      const retryParsed = tryParse(retry.content);
      const retryScenes = Array.isArray(retryParsed?.scenes) ? retryParsed.scenes : [];
      const retryViolations = findViolations(retryScenes);
      // Keep retry only if it's strictly better
      if (retryScenes.length > 0 && retryViolations.length < violations.length) {
        scenesRaw = retryScenes;
        violations = retryViolations;
      }
    }
  }

  if (scenesRaw.length === 0) {
    return NextResponse.json(
      { error: "AI returned empty scenes array" },
      { status: 502 }
    );
  }

  // Sanitize — coerce to expected shape, drop garbage
  const cleaned = scenesRaw
    .filter((s: any) => s && typeof s === "object")
    .map((s: any, i: number) => ({
      idx: i,
      narration: String(s.narration || s.text || "").trim().slice(0, 400),
      image_prompt: String(s.image_prompt || s.imagePrompt || s.image || "").trim().slice(0, 800),
    }))
    .filter((s: any) => s.narration && s.image_prompt);

  // ─── HERO CHARACTER IMAGE (NEW) ──────────────────────────────────
  // Auto-generate ONE reference image of the story's main character.
  // Every scene image generation then attaches this hero image as a
  // reference so the character stays visually consistent across all
  // ${sceneCount} scenes — same face, same outfit, same build.
  //
  // Per product spec:
  //   • Auto-generated from the story (no upload, no user picker)
  //   • Regenerate-only via /api/generate/fairytale/regenerate-hero
  //   • Applies to ALL character types (person / animal / object)
  //   • If LLM returned main_character="" (no recurring protagonist),
  //     skip hero gen → scenes fall back to text-only as before.
  const mainCharacter = String(parsed?.main_character || "").trim().slice(0, 800);
  let heroImageUrl = "";
  let heroError: string | null = null;
  if (mainCharacter) {
    try {
      const cfg = await getP2Config();
      const ftModelSetting = await getSetting<{ model: string }>("fairytale_image_model");
      const adminModel = ftModelSetting?.model || cfg.imageDefault || "nano-banana-pro";
      const modelKey = adminModel.toLowerCase().includes("nano-banana")
        ? adminModel
        : "nano-banana-pro";
      const primaryModelP2 =
        (cfg.imageModels as any)?.[modelKey] || `google/${modelKey}`;
      // Hero prompt: clean reference-shot framing so the character
      // is isolated against neutral backdrop — easier for the scene
      // pipeline to extract identity and re-pose them in new settings.
      // Visual style suffix is appended so the hero matches the same
      // aesthetic the scenes will use.
      const heroPrompt =
        `${mainCharacter}\n\nClean reference portrait, neutral pose, plain backdrop, full body or 3/4 shot, sharp focus on character features, no other subjects in frame.\n\n${VISUAL_HINTS[visualStyle]}`;
      const heroCascade = await generateImageWithCascade({
        primaryProvider: "p4",
        primaryModel: modelKey,
        primaryModelP2,
        prompt: heroPrompt,
        aspectRatio: "9:16",
        fullCascade: true,
      });
      if (heroCascade.ok && heroCascade.taskId) {
        // Cascade returns a task_id — for image cascade the result URL
        // comes back synchronously inside the cascade for some providers,
        // but for safety we DON'T block here. We return the task_id +
        // poll-info so the client can show a spinner. To keep this
        // simple, insert a history row of type='fairytale-hero' that
        // settle.ts will resolve. Frontend polls /api/history filtered
        // by the returned hero_history_id.
        const admin = createAdminClient();
        const { data: heroHist } = await admin
          .from("history")
          .insert({
            user_id: session.user.id,
            type: "fairytale-hero",
            tab: "fairytale",
            status: "pending",
            prompt: heroPrompt,
            task_id: heroCascade.taskId,
            cost: 0,
            metadata: {
              provider: heroCascade.actualProvider,
              slot: heroCascade.actualSlot,
              model: heroCascade.actualModel,
              aspectRatio: "9:16",
              main_character: mainCharacter,
              fallback_used: heroCascade.fallbackUsed,
              tier_log: heroCascade.tierLog,
              upload_status: "done",
            },
          })
          .select("id, task_id")
          .single();
        if (heroHist) {
          heroImageUrl = `pending:${heroHist.id}`;
        }
      } else if (!heroCascade.ok) {
        heroError = heroCascade.error;
      }
    } catch (e: any) {
      heroError = e?.message || "Hero image generation failed";
    }
  }

  return NextResponse.json({
    ok: true,
    scenes: cleaned,
    main_character: mainCharacter,
    hero_image: heroImageUrl, // "pending:<history_id>" — client polls /api/history
    hero_error: heroError,
    style,
    tone,
    language,
    visual_style: visualStyle,
    // Surface validation diagnostics so the wizard can show "1 scene
    // was a bit off but acceptable" if needed. Doesn't change the
    // output shape — additive field.
    validation: {
      retried: violations.length > 1 ? false : violations.length === 0 ? false : false,
      remaining_violations: violations.length,
    },
  });
}
