import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { falExtractFrame, type FrameAnchor } from "@/lib/fal";
import { getCachedProductOcr, productTextLockBlock } from "@/lib/product-ocr";

// POST /api/extend/video
//
// Triggered from the EXTEND button on a video history card. Reuses the same
// segment-chain pipeline as 16s mode:
//   1. extract anchor frame from source video
//   2. build seg-2 prompt with character lock + product text lock
//   3. fire Veo r2v with extracted frame as reference
//   4. seg-2 settles → segment-chain auto-merges with source clip
//
// Body shape:
//   {
//     source_history_id: string,    // history.id of the clip being extended
//     source_video_url: string,     // current output_url of that clip
//     source_duration: number,      // 8 or 16
//     bucket: "ugc" | "cinema" | "auto",
//     frame_anchor: "first" | "middle" | "last",
//     seg2_prompt: string,          // user's continuation prompt
//     character_lock?: string,      // optional, UGC continuity
//     product_image_url?: string,   // optional, for product text lock
//     product_description?: string,
//     voice?: string,               // for Veo voice direction injection
//     aspect_ratio?: string,        // default 9:16
//   }

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VOICE_MAP: Record<string, string> = {
  achernar: "Achernar — soft, high-pitched, gentle female voice. Light airy timbre.",
  achird: "Achird — friendly, mid-pitch, warm masculine voice.",
  algenib: "Algenib — gravelly, low-pitched, masculine voice. Deep rough timbre.",
  callirrhoe: "Callirrhoe — neutral mid-pitch female voice, natural conversational.",
  charon: "Charon — deep authoritative masculine voice.",
  enceladus: "Enceladus — mature warm female voice, mom-tone.",
  gacrux: "Gacrux — energetic excited masculine voice, hype.",
  iapetus: "Iapetus — young upbeat female voice, Gen Z energy.",
};

const STANDARD_LOCKS = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture, no-makeup-makeup.
VISUAL: RAW UNEDITED FOOTAGE — no subtitles, captions, sticker text, watermarks.

Negative: cartoon, anime, plastic skin, glam makeup, softbox studio lighting, duplicate limbs, distorted fingers, warped product label, text drift, multiple speakers.`;

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceHistoryId = String(body?.source_history_id || "");
  const sourceVideoUrl = String(body?.source_video_url || "");
  const sourceDuration = Number(body?.source_duration || 8);
  const bucket = body?.bucket === "cinema" ? "cinema" : body?.bucket === "auto" ? "auto" : "ugc";
  const frameAnchor = (["first", "middle", "last"].includes(body?.frame_anchor)
    ? body.frame_anchor
    : "last") as FrameAnchor;
  const seg2Prompt = String(body?.seg2_prompt || "").trim();
  const characterLock = String(body?.character_lock || "").trim();
  const productImageUrl = String(body?.product_image_url || "");
  const voiceId = body?.voice ? String(body.voice) : "";
  const aspectRatio = String(body?.aspect_ratio || "9:16");

  if (!sourceHistoryId || !sourceVideoUrl) {
    return NextResponse.json(
      { error: "source_history_id and source_video_url required" },
      { status: 400 }
    );
  }
  if (!seg2Prompt) {
    return NextResponse.json({ error: "seg2_prompt required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify source history belongs to user + is settled
  const { data: source } = await admin
    .from("history")
    .select("id, user_id, type, tab, status, output_url, metadata, parent_history_id, segment_index")
    .eq("id", sourceHistoryId)
    .single();
  if (!source || source.user_id !== user.id) {
    return NextResponse.json({ error: "Source clip not found" }, { status: 404 });
  }
  if (source.status !== "done") {
    return NextResponse.json(
      { error: "Source clip is not ready yet — wait for it to finish" },
      { status: 400 }
    );
  }

  // Pre-flight credit check (extend = +8s = video_8s rate)
  const cost = await priceFor(user.id, "video_8s");
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu RM ${cost.toFixed(2)}.` },
      { status: 402 }
    );
  }

  // 1. Extract frame from source video at anchor
  const frameRes = await falExtractFrame(sourceVideoUrl, frameAnchor, sourceDuration);
  if (!frameRes.ok || !frameRes.url) {
    return NextResponse.json(
      { error: `Frame extract failed: ${frameRes.error}` },
      { status: 502 }
    );
  }

  // 2. Build seg-2 prompt with all available locks
  const compose: string[] = [seg2Prompt];
  if (characterLock) compose.push(characterLock);

  // Product text lock (if user provided product image — runs OCR cached)
  let productOcr: any = null;
  if (productImageUrl) {
    productOcr = await getCachedProductOcr(user.id, productImageUrl).catch(() => null);
    const lockBlock = productTextLockBlock(productOcr);
    if (lockBlock) compose.push(lockBlock);
  }

  const voiceLine = voiceId ? VOICE_MAP[voiceId] : "";
  const fullPrompt =
    `${compose.join("\n\n").trim()}` +
    (voiceLine ? `\n\nVoice direction: ${voiceLine}` : "") +
    STANDARD_LOCKS;

  // 3. Fire seg-2 task
  const cfg = await getP2Config();
  const model = bucket === "cinema" ? cfg.grokI2V : cfg.videoR2V;
  if (!model) {
    return NextResponse.json({ error: "Model not configured" }, { status: 500 });
  }

  const created = await p2CreateTask({
    model,
    prompt: fullPrompt,
    imageUrls: [frameRes.url],
    durationMode: "8",
    aspectRatio,
    imageMode: bucket === "cinema" ? "frame" : "ingredient",
  });

  // 4. Insert seg-2 history row (parent_history_id = source clip)
  const { data: child } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: source.metadata?.project_id || null,
      type: "video",
      tab: bucket === "cinema" ? "cinema" : bucket === "auto" ? "auto" : "video",
      status: created.ok && created.task_id ? "pending" : "failed",
      prompt: fullPrompt,
      reference_url: frameRes.url,
      task_id: created.task_id || null,
      duration: 8,
      cost,
      segment_index: 2,
      parent_history_id: sourceHistoryId,
      frame_anchor: frameAnchor,
      error_message: created.ok ? null : created.error || "Extend P2 create failed",
      metadata: {
        agent: "extend",
        segment_role: "seg2",
        source_history_id: sourceHistoryId,
        anchor_frame_url: frameRes.url,
        bucket,
        aspectRatio,
        product_ocr: productOcr || null,
        character_lock: characterLock || null,
        voice: voiceId || null,
        voice_line: voiceLine || null,
      },
    })
    .select()
    .single();

  if (!child) {
    return NextResponse.json({ error: "Failed to insert seg-2 row" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    seg2_history_id: child.id,
    parent_history_id: sourceHistoryId,
    cost,
  });
}
