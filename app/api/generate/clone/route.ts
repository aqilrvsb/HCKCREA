import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orChatVision } from "@/lib/openrouter";

// Clone Prompt — input: frames + product + mode (ugc|cinema). Output: a
// list of segment prompts (no video generation). Per-segment vision calls
// run in parallel so 60 frames don't blow the request size or token budget.
//
// UGC mode    → Veo 3.1 target, each segment = 8 frames (8s window)
// Cinema mode → Grok Imagine target, each segment = up to 30 frames (30s)
//
// Body:
//   frames: string[]            // base64 data URLs (≤60)
//   product_image_url?: string  // public URL (already uploaded)
//   custom_dialog?: string
//   duration?: number           // source video length in seconds
//   mode?: 'ugc' | 'cinema'
//   project_id?: string

const SEG_FRAMES_UGC = 8;
const SEG_FRAMES_CINEMA = 30;
const MAX_FRAMES = 60;

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const allFrames: string[] = Array.isArray(body?.frames)
    ? body.frames.filter((f: any) => typeof f === "string" && f.length > 0).slice(0, MAX_FRAMES)
    : [];
  const productImageUrl = String(body?.product_image_url || "").trim();
  const customDialog = String(body?.custom_dialog || "").trim();
  const refDuration = Number(body?.duration || allFrames.length || 8);
  const mode: "ugc" | "cinema" = body?.mode === "cinema" ? "cinema" : "ugc";

  if (allFrames.length === 0) {
    return NextResponse.json(
      { error: "No frames provided — extract frames in browser first" },
      { status: 400 }
    );
  }

  // Slice frames into segments
  const segLen = mode === "cinema" ? SEG_FRAMES_CINEMA : SEG_FRAMES_UGC;
  const segDur = mode === "cinema" ? 30 : 8;
  const segments: string[][] = [];
  for (let i = 0; i < allFrames.length; i += segLen) {
    segments.push(allFrames.slice(i, i + segLen));
  }
  const segCount = segments.length;

  const hasProduct = !!productImageUrl;
  const hasDialog = customDialog.length > 0;

  const baseSystemPrompt =
    mode === "ugc"
      ? `You are a video director. Produce SHORT, SHARP, STRUCTURED prompts for an 8-second text-to-video model (Veo 3.1).

Each segment uses this EXACT structure (short lines, no prose paragraphs):

SCENE: [one line — location + main subject + main action]
TIMELINE:
- 0-4s: [action + dialog chunk if any]
- 4-8s: [action + dialog chunk if any]
CHARACTER: beautiful attractive Malay [woman|man] with clear glowing skin, [exact outfit seen in reference]
VOICE:
- Tone: [observed in reference]
- Voice: Malay [woman|man] voice, [age band], [energy]
- Quality: clear studio recording, crisp consonants, no muffling
STYLE: [visual style], shallow depth of field, audio dialogue only, clean vertical frame
CAMERA: [angle + movement]
HANDS: [which hand holds what]
CONSTRAINTS:
- Anatomy: 2 hands, 5 fingers each, no extra limbs
- Product: pixel-identical to reference — no warped label, no recolor, no text drift
- AUDIO + VISUAL LOCK: speak directly to camera, NO music, NO SFX, dialog only. NO subtitles, captions, overlays. Bottom 25% of frame EMPTY. RAW UNEDITED FOOTAGE — never a TikTok post.

The segment is SELF-CONTAINED — do NOT reference other segments. Keep prompt 300-600 chars.`
      : `You are a cinematic director. Produce a structured prompt for a 30-second text-to-video model (Grok Imagine).

Use this structure:

SCENE: [location + subject + main action]
TIMELINE:
- 0-10s: [setup + first beat]
- 10-20s: [development + main beat]
- 20-30s: [resolution + final beat]
CHARACTER: [physical description, outfit, personality]
VOICE: [tone, language, pace, emotion arc]
STYLE: [cinematic style — film stock, color grade, lighting key, lens]
CAMERA: [shot list — establishing, mediums, close-ups, movement]
SOUND DESIGN: [atmosphere, ambient, music cues if any]
PACING: [emotional rhythm across the 30s]

Keep the prompt 600-1200 chars. Cinematic and evocative — paint the scene.`;

  // Each parallel call gets its own segment slice and a tiny variation of the
  // user prompt that tells it which slice it's working on. Returns the prompt
  // string for that segment — we aggregate at the end.
  async function planSegment(
    segIdx: number,
    segFrames: string[]
  ): Promise<{ idx: number; prompt: string; error?: string }> {
    const startSec = segIdx * segDur;
    const endSec = startSec + segDur;
    const dialogBlock = hasDialog
      ? `\n\nDIALOG (USER-PROVIDED, MUST USE VERBATIM):
"""
${customDialog.replace(/"""/g, '"""')}
"""
For this segment (${startSec}-${endSec}s), pick the matching slice of the user's dialog. Parse timestamps if present (e.g. ${startSec}s-${endSec}s). Otherwise pick the natural chunk for this time window. Never translate, never paraphrase.`
      : "";

    const productBlock = hasProduct
      ? `\n\nThe last image is the product reference. Keep it pixel-identical in the prompt — preserve label text, logo, colors exactly.`
      : "";

    const systemPrompt = baseSystemPrompt + dialogBlock + productBlock;
    const textPrompt = `Segment ${segIdx + 1} of ${segCount} (${startSec}-${endSec}s window).
These ${segFrames.length} frames are the reference for this segment, sampled 1 frame per second.
Study them carefully and write ONE prompt that recreates this slice exactly.

Return ONLY the prompt text — no JSON wrapping, no commentary, no markdown.`;

    const visionImages = [...segFrames];
    if (productImageUrl) visionImages.push(productImageUrl);

    const result = await orChatVision({
      modelKey: "model_clone",
      systemPrompt,
      textPrompt,
      images: visionImages,
      temperature: 0.5,
      maxTokens: 2000,
    });
    if (!result.ok || !result.content) {
      return { idx: segIdx, prompt: "", error: result.error || "vision call failed" };
    }
    let cleaned = result.content.trim();
    // Strip markdown if present
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
    return { idx: segIdx, prompt: cleaned };
  }

  // Fire all segments in parallel
  const results = await Promise.all(
    segments.map((segFrames, idx) => planSegment(idx, segFrames))
  );

  const failures = results.filter((r) => r.error);
  const prompts = results
    .filter((r) => !r.error && r.prompt && r.prompt.length > 30)
    .sort((a, b) => a.idx - b.idx)
    .map((r) => r.prompt);

  if (prompts.length === 0) {
    return NextResponse.json(
      {
        error: failures[0]?.error || "All segment plans failed",
        details: failures.map((f) => f.error).slice(0, 3),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    mode,
    segments: prompts.length,
    seg_duration: segDur,
    duration: refDuration,
    prompts,
    partial: failures.length > 0,
    failures: failures.length,
  });
}
