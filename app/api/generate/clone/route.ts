import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChatVision } from "@/lib/openrouter";

// Clone Prompt — placeholder-first.
//
// Pattern matches the Chrome extension at creative-hack-auto/background.js:
//   - ONE vision call analysing ALL frames of the source video.
//   - Asks the model for a structured JSON response: { segments, prompts: [] }.
//   - Robust parsing — strips markdown, regex-fallback for partial JSON,
//     and final fallback that treats the entire response as one prompt.
//   - Temperature 0.5 for structured output (extension uses the same).
//
// The previous parallel-per-segment approach was unreliable on Gemini 2.5
// Flash (returned empty content sometimes, causing "vision call failed").
// Single-call avoids that and is also cheaper (one round-trip, not N).

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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

  // Plan how many segments the user gets back. UGC = 8s each, Cinema = 30s each.
  const segDur = mode === "cinema" ? 30 : 8;
  const segCount = Math.max(1, Math.ceil(refDuration / segDur));

  // Insert placeholder NOW.
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

      const baseSystem =
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

Every segment is SELF-CONTAINED — do NOT write "same as segment 1". Only SCENE / TIMELINE / HANDS differ per segment.`
          : `You are a cinematic director. Produce structured prompts for a 30-second text-to-video model (Grok Imagine).

Use this structure per segment:

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

Every segment is SELF-CONTAINED — do NOT cross-reference. Cinematic and evocative.`;

      const dialogBlock = hasDialog
        ? `\n\nDIALOG (USER-PROVIDED, MUST USE VERBATIM):\n"""\n${customDialog.replace(/"""/g, '"""')}\n"""\nSplit dialog naturally across segments by their time windows.`
        : "";

      const productBlock = hasProduct
        ? `\n\nThe LAST image attached is the product reference. Keep it pixel-identical in every prompt — preserve label text, logo, colors exactly.`
        : "";

      const systemPrompt = baseSystem + dialogBlock + productBlock;
      const textPrompt = `These are ${allFrames.length} frames extracted at 1 frame per second from a ${refDuration}s reference video. Study every frame carefully and produce ${segCount} segment prompt${segCount > 1 ? "s" : ""} that recreate the video.

Return JSON ONLY in this exact shape (no markdown, no commentary):
{
  "segments": ${segCount},
  "prompts": [ "<segment 1 prompt>", "<segment 2 prompt>", ... ]
}`;

      const visionImages = [...allFrames];
      if (productImageUrl) visionImages.push(productImageUrl);

      const result = await orChatVision({
        modelKey: "model_clone",
        systemPrompt,
        textPrompt,
        images: visionImages,
        temperature: 0.5,
        maxTokens: 4000,
      });

      if (!result.ok || !result.content) {
        // Surface the actual upstream error so the user (and Vercel logs)
        // see what OpenRouter returned. "vision call failed" with no detail
        // hides everything; this gives us the HTTP/model error.
        const detail = result.error || "OpenRouter returned empty content";
        console.error("[clone] vision call failed:", detail);
        await admin.from("history").update({
          status: "failed",
          error_message: detail,
          metadata: {
            mode, seg_duration: segDur, seg_count: segCount, aspectRatio,
            upload_status: "failed",
            vision_error: detail,
          },
        }).eq("id", historyId);
        return;
      }

      // Parse the model's response — expect JSON, but tolerate markdown
      // code fences and plain text fallback.
      const raw = result.content.trim();
      let prompts: string[] = [];

      function tryParse(s: string): string[] | null {
        try {
          const obj = JSON.parse(s);
          if (obj && Array.isArray(obj.prompts)) {
            return obj.prompts.filter((p: any) => typeof p === "string" && p.trim().length > 30);
          }
          if (obj && typeof obj.prompt === "string") return [obj.prompt];
        } catch {}
        return null;
      }

      // 1. Direct JSON parse
      let parsed = tryParse(raw);
      // 2. Strip markdown code fence
      if (!parsed) {
        const stripped = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = tryParse(stripped);
      }
      // 3. Regex-extract a JSON object
      if (!parsed) {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = tryParse(m[0]);
      }
      if (parsed && parsed.length > 0) {
        prompts = parsed;
      } else {
        // 4. Plain-text fallback — treat the whole response as one prompt
        if (raw.length > 30) {
          prompts = [raw];
        }
      }

      if (prompts.length === 0) {
        await admin.from("history").update({
          status: "failed",
          error_message: "Model returned no usable prompts",
          metadata: {
            mode, seg_duration: segDur, seg_count: segCount, aspectRatio,
            upload_status: "failed",
            vision_raw_preview: raw.substring(0, 500),
          },
        }).eq("id", historyId);
        return;
      }

      const joined = prompts
        .map((p, i) => `── Segment ${i + 1} ──\n${p}`)
        .join("\n\n");

      await admin
        .from("history")
        .update({
          status: "done",
          prompt: joined,
          metadata: {
            mode,
            seg_duration: segDur,
            seg_count: prompts.length,
            aspectRatio,
            segments: prompts.map((p, i) => ({ idx: i, prompt: p })),
            upload_status: "done",
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      console.error("[clone] background error:", e);
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
          metadata: {
            mode, seg_duration: segDur, seg_count: segCount, aspectRatio,
            upload_status: "failed",
            vision_error: String(e?.message || e),
          },
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    mode,
    seg_duration: segDur,
    seg_count: segCount,
    duration: refDuration,
  });
}
