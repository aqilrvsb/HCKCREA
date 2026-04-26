import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { orChatVision } from "@/lib/openrouter";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// Clone Mode — client extracts frames in-browser (canvas) and POSTs them as
// data: URLs in the `frames` array. We forward those frames directly to
// OpenRouter as multimodal image_url content blocks (no upload to RH needed
// — OpenRouter accepts base64 data URLs). The vision model returns 1-4
// segment prompts that recreate the reference; each becomes a Veo r2v video
// using the product image as anchor.
//
// Body: { frames: string[], product_image_url: string,
//         custom_dialog?: string, mode?: 'video'|'prompt',
//         aspect_ratio?: string, duration?: number, project_id?: string }
//
// Falls back to text-only planning if no frames are provided (legacy path).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const frames: string[] = Array.isArray(body?.frames)
    ? body.frames.filter((f: any) => typeof f === "string" && f.length > 0)
    : [];
  const productImageUrl = String(body?.product_image_url || "").trim();
  const customDialog = String(body?.custom_dialog || "").trim();
  const refDuration = Number(body?.duration || frames.length || 8);
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const mode = body?.mode === "prompt" ? "prompt" : "video";
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (frames.length === 0) {
    return NextResponse.json(
      { error: "No frames provided — extract frames in browser first" },
      { status: 400 }
    );
  }

  // Pre-flight: AI plans 1-4 segments; we charge for the worst case (4 × 8s)
  // upfront so the user can't exceed their balance mid-pipeline.
  const videoRate = await priceFor(user.id, "video_8s");
  const maxSegments = 4;
  const worstCaseCost = videoRate * maxSegments;
  if (!(await hasEnoughCredits(user.id, videoRate))) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu sekurang-kurangnya RM${videoRate.toFixed(2)}.` },
      { status: 402 }
    );
  }

  const hasUserDialog = customDialog.length > 0;
  const hasProduct = !!productImageUrl;

  // Verbatim system prompt from creative-hack-auto's CREATIVE_PINTEREST_ANALYZE
  // handler. Defines the segment structure Veo 3.1 reads cleanly + the
  // mandatory rules around clean frame, audio lock, and product preservation.
  const systemPrompt = `You are a video director. Produce SHORT, SHARP, STRUCTURED prompts for an 8-second text-to-video model (Veo 3.1).

REFERENCE: User uploads a ${refDuration}s video as ${frames.length} frames. Recreate it EXACTLY: same framing, same actions, same pacing.

SEGMENT PLANNING: Output 1-4 segments (each 8s). Split at natural cut points in the reference.

EACH SEGMENT USES THIS EXACT STRUCTURE (all sections required, short lines, no prose paragraphs):

SCENE: [one line — location + main subject + main action]
TIMELINE:
- 0-4s: [action + dialog chunk if any]
- 4-8s: [action + dialog chunk if any]
CHARACTER: beautiful attractive Malay [woman|man] with clear glowing skin, [exact outfit seen in reference — hijab color/style, top garment type/sleeve length/color/pattern, bottom, accessories] (observe the reference video — do NOT assume pink/floral/kebaya etc; use EXACTLY what the reference shows; gender matches the reference speaker)
VOICE:
- Tone: [tone observed in reference — e.g. santai / excited / storytelling / calm / confident]
- Voice: Malay [woman|man] voice in their [age band from reference — 20s / 30s / 40s / 50s], [energy from reference — cheerful, warm, nurturing, confident, casual]
- Quality: clear studio recording, crisp consonants, natural treble, no muffling, no underwater effect, no bass-heavy compression
STYLE: [visual style observed in reference — e.g. soft natural / golden hour / studio lit / UGC handheld / moody / bright clean], shallow depth of field, cinematic film look, audio dialogue only, clean vertical frame
CAMERA: [angle + movement — e.g. "eye-level medium shot, static camera"]
HANDS: [which hand holds what, which hand does what — e.g. "LEFT hand holds the product upright facing camera; RIGHT hand stirs the wok with a spatula throughout"]
CONSTRAINTS:
- Anatomy: exactly 2 hands with 5 fingers each, 2 arms, 2 legs, 1 head, no extra limbs, no warped body
- Product: preserve package exactly as shown — do not alter label, logo, or colors
- AUDIO + VISUAL LOCK (MANDATORY — HIGHEST PRIORITY): The character speaks directly to camera with clear voice. NO background music, NO instrumental, NO sound effects. All audio is spoken dialog only. NO subtitles or text overlays, NO on-screen dialogue text. Clean vertical video frame with no interface overlay, no icons, no overlay elements.
- Audio: dialogue only, ONE single voice on-screen, no music, no instrumental, no SFX, no other voices, no audience, no background chatter
- Clean frame (RAW UNEDITED FOOTAGE AESTHETIC — critical to prevent Veo's auto-captioning):
  The frame is RAW unedited footage, NOT published TikTok content. The bottom 25% of the frame is COMPLETELY EMPTY — no text, no auto-captions, no subtitle track, no closed captions, no dialog text appearing at the bottom as the person speaks, no TikTok-style animated captions, no sticker text, no pop-up text bubbles.
  Zero subtitles. Zero captions. Zero auto-generated dialog text. Zero icons. Zero emojis. Zero graphics. Zero overlays. Zero watermarks. Zero UI elements. Zero handles/usernames. Zero hashtags visible.
  If the dialog mentions "beg kuning" or any shopping/purchase term, it is SPOKEN DIALOG ONLY — NEVER render it as a yellow bag icon, shopping bag graphic, button, or visual element. Audience HEARS it, never SEES it drawn.
  On-screen frame shows ONLY the person, the product, and the real-world setting — nothing else. Treat the output like a camera recording a moment, NOT a TikTok post.

HARD RULES (apply across all segments):
1. Every segment is SELF-CONTAINED. Do NOT write "same as segment 1", "same as reference", "continue from previous", "matching the earlier frame". Just describe the scene directly.
2. CHARACTER / VOICE / STYLE / CAMERA blocks are IDENTICAL across all segments — copy word-for-word.
3. Only SCENE / TIMELINE / HANDS differ per segment (what's happening at that 8-second slice).
4. Keep prompts TIGHT. Aim 300-600 characters per segment. Sharp over verbose.
5. The product: refer to it ONLY as "the product". Never describe its shape, container type, texture, color, or category.

${hasUserDialog
  ? `DIALOG (USER-PROVIDED, MUST USE VERBATIM):
"""
${customDialog.replace(/"""/g, '"""')}
"""
Parse timestamps if present (0s-4s → seg 1 @ 0-4s; 8s-12s → seg 2 @ 0-4s; etc.). Otherwise split naturally. Never translate, never paraphrase. Include dialog chunks inside TIMELINE lines like: '0-4s: LEFT hand lifts product closer to camera; she says "korang tunggu apa lagi"'.`
  : `DIALOG: Only if reference shows a speaking person. Keep short (4-8 words per 4s slot). Match reference's energy. Never invent content not implied by the reference.`}

${!hasProduct ? 'No product image provided — omit the "Product:" constraint line and just describe whatever appears in the reference naturally.' : ""}

OUTPUT: Return ONLY this JSON (no markdown, no commentary):
{
  "segments": <1-4>,
  "prompts": [
    "<segment 1 prompt using the structure above>",
    "<segment 2 prompt using the structure above>",
    ...
  ]
}`;

  const textPrompt = `These are ${frames.length} frames extracted at 1 frame per second from a ${refDuration}s reference video. Study every frame carefully. First decide how many 8s segments (1-4) best recreate this video naturally — cut at scene changes or motion beats. Then write one exact-recreation prompt per segment describing camera, lighting, motion, actions, and timing EXACTLY as shown. Return JSON: {"segments": N, "prompts": [...]}.`;

  // Send frames + product image as multimodal content. OpenRouter accepts
  // base64 data URLs in image_url blocks (OpenAI-compatible).
  const visionImages = [...frames];
  if (productImageUrl) visionImages.push(productImageUrl);

  const plan = await orChatVision({
    modelKey: "model_clone",
    systemPrompt,
    textPrompt,
    images: visionImages,
    temperature: 0.5,
    maxTokens: 6000,
  });
  if (!plan.ok || !plan.content) {
    return NextResponse.json(
      { error: plan.error || "Clone plan failed" },
      { status: 502 }
    );
  }

  let prompts: string[] = [];
  try {
    let cleaned = plan.content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    cleaned = cleaned.replace(/[\n\r\t]/g, " ");
    let s = cleaned.indexOf("{");
    let e = cleaned.lastIndexOf("}");
    if (s < 0 || e <= s) {
      s = cleaned.indexOf("[");
      e = cleaned.lastIndexOf("]");
    }
    if (s >= 0 && e > s) cleaned = cleaned.substring(s, e + 1);
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
    const obj = JSON.parse(cleaned);
    if (Array.isArray(obj)) {
      prompts = obj.map((p: any) => (typeof p === "string" ? p : p?.prompt || ""));
    } else if (Array.isArray(obj.prompts)) {
      prompts = obj.prompts.map((p: any) => (typeof p === "string" ? p : p?.prompt || ""));
    } else if (typeof obj.prompt === "string") {
      prompts = [obj.prompt];
    }
  } catch {}

  prompts = prompts.filter((p) => typeof p === "string" && p.length > 30).slice(0, 4);
  if (!prompts.length) {
    return NextResponse.json({ error: "Clone plan parse failed" }, { status: 502 });
  }

  const totalCost = videoRate * prompts.length;

  // Prompt-only mode: just return the plan, don't kick off generations.
  if (mode === "prompt") {
    return NextResponse.json({
      ok: true,
      mode: "prompt",
      segments: prompts.length,
      prompts,
      total_cost: 0,
    });
  }

  const admin = createAdminClient();
  const cfg = await getP2Config();

  const { data: batch } = await admin
    .from("batches")
    .insert({
      user_id: user.id,
      project_id: projectId,
      product_image_url: productImageUrl,
      quantity: prompts.length,
      duration_mode: "8",
      status: "generating",
      master_plan: prompts.map((p) => ({ prompt: p })),
    })
    .select()
    .single();

  const histories: any[] = [];
  await Promise.all(
    prompts.map(async (p, idx) => {
      const useIngredient = !!productImageUrl;
      const created = await p2CreateTask({
        model: useIngredient ? cfg.videoR2V : cfg.videoT2V,
        prompt: p,
        imageUrls: useIngredient ? [productImageUrl] : [],
        durationMode: "8",
        aspectRatio,
        imageMode: useIngredient ? "ingredient" : "text",
      });
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "clone",
          tab: "clone",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: p,
          reference_url: productImageUrl || null,
          task_id: created.task_id || null,
          duration: 8,
          cost: videoRate,
          batch_id: batch?.id,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: { segment_index: idx, model: useIngredient ? "veo3-1-fast-r2v" : "veo3-1-fast-t2v" },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );

  return NextResponse.json({
    ok: true,
    batch_id: batch?.id,
    history_ids: histories.map((h) => h.id),
    segments: prompts.length,
    total_cost: totalCost,
  });
}
