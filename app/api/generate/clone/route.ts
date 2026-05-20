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
        image_urls: productImageUrl ? [productImageUrl] : [],
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

      // Provider-agnostic frame-by-frame clone. The prompt describes
      // the reference video EXACTLY as observed (location, subject,
      // outfit, camera, action) and emits a placeholder "Dialog: 0s-Xs"
      // line for the user to fill in later. X is the segment's actual
      // end second (e.g. an 8s segment → "Dialog: 0s-8s [user fills]").
      // The output is intentionally generic — user pastes it into UGC /
      // Original Video / Auto Content / etc, picks the provider there.
      const baseSystem = `You are a video frame-by-frame describer. Your job is to study the attached frames and produce a SELF-CONTAINED text prompt that, if fed to any video model (Veo / Grok / Sora 2), would reproduce the segment as closely as possible to the SECOND frame onwards.

Each segment uses this EXACT structure (short lines, no prose paragraphs):

SCENE: [one concrete line — exact location + main subject + main action observed in the frames]
CHARACTER: [exact appearance from the frames — gender, age band, ethnicity if visible, outfit pieces with colors and fabric, hair/hijab, accessories]
HANDS: [which hand holds what — left hand vs right hand, what they're touching/lifting/pointing at]
CAMERA: [shot type + angle + movement observed — e.g. medium shot, eye level, slow handheld push-in / static / pan-left]
LIGHTING: [observed light direction + temperature + mood — e.g. warm window light from camera-left, soft fill from front, cozy daylight]
BACKGROUND: [specific elements visible behind subject — furniture, props, plants, walls, kitchen items, etc. Not generic "in a kitchen", instead "modern kitchen with white cabinets, wooden countertop, small plant in window"]
ACTION: [exact beat-by-beat motion across the segment — what the subject DOES from second 0 to second N]
Dialog: 0s-{segDur}s — [USER FILLS THIS IN LATER]

Rules:
- The SECOND frame onwards is what the prompt must match. The first frame may be a flash/cut transition; trust the second frame as the canonical start state.
- Be SPECIFIC about every visible element. Reject generic phrasing ("standing in a room", "wearing a shirt"). Name colors, textures, brands if visible.
- Anatomy lock: state "2 hands, 5 fingers each" if subject's hands are visible.
- Provider-agnostic: do NOT mention Veo, Grok, Sora 2, or any model-specific format (no "Dialogue:" block, no "Spoken dialog:", no "Cinematography:" block). Just the SCENE / CHARACTER / HANDS / CAMERA / LIGHTING / BACKGROUND / ACTION / Dialog: lines.
- Output the Dialog: line VERBATIM as "Dialog: 0s-{segDur}s — [USER FILLS THIS IN LATER]" so the user knows the timing window when they paste the prompt elsewhere.

Every segment is SELF-CONTAINED — do NOT write "same as segment 1". Each prompt must stand alone and contain every detail needed to reproduce that segment from scratch.`.replace(/\{segDur\}/g, String(segDur));

      const productBlock = hasProduct
        ? `\n\nThe LAST image attached is the product reference. Keep it pixel-identical in every prompt — preserve label text, logo, colors exactly.`
        : "";

      const systemPrompt = baseSystem + productBlock;
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
