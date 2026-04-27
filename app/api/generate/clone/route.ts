import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChatVision } from "@/lib/openrouter";

// Clone Prompt — placeholder-first.
//
// Hot path (~300ms):
//   1. getSession + minimal validation
//   2. Insert pending history row with type='clone', tab='clone'. The card
//      lives in the dashboard's clone HistoryGrid as a "Generating…" entry.
//   3. Return history_id immediately.
//
// after() background:
//   4. Slice frames into segments
//   5. Run vision calls in parallel (1 per segment) via OpenRouter
//   6. On success → update row with prompt = joined prompts, status=done.
//      metadata.segments preserves the per-segment prompt array for the
//      modal view.
//   7. On failure → row flips to 'failed' with the error.
//
// Body:
//   frames: string[]            // base64 data URLs (≤60)
//   product_image_url?: string
//   custom_dialog?: string
//   duration?: number
//   mode?: 'ugc' | 'cinema'
//   project_id?: string
//   aspect_ratio?: string

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SEG_FRAMES_UGC = 8;
const SEG_FRAMES_CINEMA = 30;
const MAX_FRAMES = 60;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const allFrames: string[] = Array.isArray(body?.frames)
    ? body.frames.filter((f: any) => typeof f === "string" && f.length > 0).slice(0, MAX_FRAMES)
    : [];
  const productImageUrl = String(body?.product_image_url || "").trim();
  const customDialog = String(body?.custom_dialog || "").trim();
  const refDuration = Number(body?.duration || allFrames.length || 8);
  const mode: "ugc" | "cinema" = body?.mode === "cinema" ? "cinema" : "ugc";
  const projectId = body?.project_id ? String(body.project_id) : null;
  const aspectRatio = String(body?.aspect_ratio || "9:16");

  if (allFrames.length === 0) {
    return NextResponse.json(
      { error: "No frames provided — extract frames in browser first" },
      { status: 400 }
    );
  }

  const segLen = mode === "cinema" ? SEG_FRAMES_CINEMA : SEG_FRAMES_UGC;
  const segDur = mode === "cinema" ? 30 : 8;
  const segments: string[][] = [];
  for (let i = 0; i < allFrames.length; i += segLen) {
    segments.push(allFrames.slice(i, i + segLen));
  }
  const segCount = segments.length;

  // Insert placeholder NOW. status='pending' + tab='clone' so the dashboard
  // clone HistoryGrid renders a Generating… card immediately.
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "clone",
      tab: "clone",
      status: "pending",
      prompt: `Cloning ${segCount} segment${segCount > 1 ? "s" : ""}…`,
      reference_url: productImageUrl || null,
      task_id: null,
      duration: refDuration,
      cost: 0,
      metadata: {
        mode,
        seg_duration: segDur,
        seg_count: segCount,
        aspectRatio,
        upload_status: "queued",
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const historyId = hist.id;

  after(async () => {
    try {
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
        cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
        return { idx: segIdx, prompt: cleaned };
      }

      const results = await Promise.all(
        segments.map((segFrames, idx) => planSegment(idx, segFrames))
      );

      const failures = results.filter((r) => r.error);
      const ordered = results
        .filter((r) => !r.error && r.prompt && r.prompt.length > 30)
        .sort((a, b) => a.idx - b.idx);

      if (ordered.length === 0) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message:
              failures[0]?.error || "All segment plans failed",
            metadata: {
              mode, seg_duration: segDur, seg_count: segCount, aspectRatio,
              failures: failures.length,
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }

      // Join segment prompts with a clear separator. Modal view can split
      // on "── Segment N ──" if it wants the structured form.
      const joined = ordered
        .map((r) => `── Segment ${r.idx + 1} ──\n${r.prompt}`)
        .join("\n\n");

      await admin
        .from("history")
        .update({
          status: "done",
          prompt: joined,
          metadata: {
            mode,
            seg_duration: segDur,
            seg_count: ordered.length,
            aspectRatio,
            partial: failures.length > 0,
            failures: failures.length,
            segments: ordered.map((r) => ({ idx: r.idx, prompt: r.prompt })),
            upload_status: "done",
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
          metadata: {
            mode, seg_duration: segDur, seg_count: segCount, aspectRatio,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    mode,
    segments: segCount,
    seg_duration: segDur,
    duration: refDuration,
  });
}
