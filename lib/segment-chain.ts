// Segment chain logic — fires seg-2 after seg-1 settles, and merges after
// seg-2 settles. Called from lib/settle.ts inside the success branch.
//
// Architecture (16s clip):
//   PARENT row (seg-1):
//     - segment_index = 1
//     - parent_history_id = NULL
//     - cost = full 16s price
//     - metadata.duration_mode = "16s"
//     - metadata.seg2_prompt, character_lock, voice_line, product_ocr, …
//     - frame_anchor = "first" | "middle" | "last"
//     - When P2 settles its task to 'done', output_url = seg-1 video URL
//     - merged_url = NULL until merge step completes (then = final 16s URL)
//
//   CHILD row (seg-2):
//     - segment_index = 2
//     - parent_history_id = parent.id
//     - cost = 0 (parent already charged)
//     - metadata.parent_history_id (same)
//     - When P2 settles its task to 'done', output_url = seg-2 video URL,
//       triggering the merge step
//
// Both segments use Veo r2v with durationMode "8" — the 16s composite is
// produced by ffmpeg concat, NOT by a single 16s Veo call.

import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { falExtractFrame, falMergeVideos, type FrameAnchor } from "@/lib/fal";
import { productTextLockBlock } from "@/lib/product-ocr";

type Settled = {
  id: string;
  user_id: string;
  type: string;
  tab?: string | null;
  task_id: string | null;
  duration?: number | null;
  cost?: number | string | null;
  prompt?: string | null;
  reference_url?: string | null;
  project_id?: string | null;
  metadata?: any;
  segment_index?: number | null;
  parent_history_id?: string | null;
  frame_anchor?: string | null;
  output_url?: string | null;
  merged_url?: string | null;
};

// Apply the same lock block agent-ugc.ts withLocks() uses. Keep in sync if the
// canonical block changes there.
function appendLocks(corePrompt: string, voiceLine?: string): string {
  const locks = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.
VISUAL: RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags.

Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot (unless explicitly chosen), staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, multiple speakers, voiceover narration, music score.`;
  return `${corePrompt.trim()}${voiceLine ? `\n\nVoice direction: ${voiceLine}` : ""}${locks}`;
}

// ──────────────────────────────────────────────────────────────────────────
// onSegmentSettled — entry point called from settle.ts after a row flips
// to 'done'. Idempotent — the seg-2 child / merged_url checks ensure each
// stage runs at most once even if settle is called twice for the same row.
// ──────────────────────────────────────────────────────────────────────────

export async function onSegmentSettled(
  hist: Settled,
  outputUrl: string
): Promise<void> {
  // Video / UGC / Auto Content rows are eligible. Image / clone are not.
  if (
    hist.type !== "video" &&
    hist.type !== "ugc" &&
    hist.type !== "auto-content"
  ) {
    return;
  }

  // Branch 1: this is seg-1 of a 16s clip — fire seg-2
  if (
    hist.segment_index === 1 &&
    !hist.parent_history_id &&
    hist.metadata?.duration_mode === "16s"
  ) {
    await fireSeg2(hist, outputUrl).catch((e) => {
      console.error("[segment-chain] seg-2 fire failed:", e);
    });
    return;
  }

  // Branch 2: this is seg-2 of a 16s clip — merge with parent's seg-1
  if (hist.segment_index === 2 && hist.parent_history_id) {
    await mergeSegments(hist, outputUrl).catch((e) => {
      console.error("[segment-chain] merge failed:", e);
    });
    return;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// fireSeg2 — extract frame at frame_anchor, build seg-2 prompt with all
// continuity locks (character + voice + product text), insert seg-2 row,
// fire P2 task. Idempotent: if a seg-2 child already exists for this parent,
// skip.
// ──────────────────────────────────────────────────────────────────────────

async function fireSeg2(parent: Settled, parentOutputUrl: string): Promise<void> {
  const admin = createAdminClient();

  // Idempotency check — if seg-2 already exists for this parent, abort
  const { data: existingChild } = await admin
    .from("history")
    .select("id")
    .eq("parent_history_id", parent.id)
    .eq("segment_index", 2)
    .maybeSingle();
  if (existingChild) {
    console.log(`[segment-chain] seg-2 already exists for parent ${parent.id}, skipping`);
    return;
  }

  const meta = parent.metadata || {};
  const frameAnchor = (parent.frame_anchor || "last") as FrameAnchor;

  // 1. Extract frame from seg-1 video
  const frameRes = await falExtractFrame(parentOutputUrl, frameAnchor, 8);
  if (!frameRes.ok || !frameRes.url) {
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: `Seg-2 frame extract failed: ${frameRes.error}`,
      })
      .eq("id", parent.id);
    return;
  }
  const anchorFrameUrl = frameRes.url;

  // 2. Build seg-2 prompt with all continuity locks
  const characterLock = String(meta.character_lock || "").trim();
  const seg2Body = String(meta.seg2_prompt || "").trim();
  const voiceLine = String(meta.voice_line || "");
  const productTextLock = productTextLockBlock(meta.product_ocr);

  if (!seg2Body) {
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: "Seg-2 prompt missing — cannot continue 16s chain",
      })
      .eq("id", parent.id);
    return;
  }

  // Compose: seg2_body + character_lock + product_text_lock + locks + voice
  const compose = [seg2Body];
  if (characterLock) compose.push(characterLock);
  if (productTextLock) compose.push(productTextLock);
  const seg2Prompt = appendLocks(compose.join("\n\n"), voiceLine || undefined);

  // 3. Fire seg-2 P2 task (uses extracted frame as r2v reference, NOT product)
  const cfg = await getP2Config();
  const created = await p2CreateTask({
    model: cfg.videoR2V,
    userId: parent.user_id,
    prompt: seg2Prompt,
    imageUrls: [anchorFrameUrl],
    durationMode: "8",
    aspectRatio: meta.aspectRatio || "9:16",
    imageMode: "ingredient",
  });

  // 4. Insert seg-2 history row (cost=0, parent already charged).
  // Inherit type + tab from the parent so Auto Content seg-2 lands in
  // the auto grid, manual UGC seg-2 lands in the video grid, and the
  // AI Agent UGC seg-2 stays in video too.
  await admin.from("history").insert({
    user_id: parent.user_id,
    project_id: parent.project_id,
    type: parent.type || "video",
    tab: parent.tab || "video",
    status: created.ok && created.task_id ? "pending" : "failed",
    prompt: seg2Prompt,
    framework: `seg2/${meta.scene || ""}/${meta.persona || ""}`,
    reference_url: anchorFrameUrl,
    task_id: created.task_id || null,
    duration: 8,
    cost: 0,
    segment_index: 2,
    parent_history_id: parent.id,
    frame_anchor: frameAnchor,
    error_message: created.ok ? null : created.error || "Seg-2 P2 create failed",
    metadata: {
      ...meta,
      segment_role: "seg2",
      anchor_frame_url: anchorFrameUrl,
      // Stamp provider per-row so settle/recheck queries the correct
      // upstream (P1 vs P2). Without this the recheck path defaults to
      // P2 and a P1 seg-2 stays "pending" forever even when P1 is done.
      provider: created.provider || meta.provider || "p2",
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// mergeSegments — given a settled seg-2 row, find the parent's seg-1 video,
// merge via fal, update parent.merged_url + parent.output_url to the merged
// video. Idempotent: if parent.merged_url is already set, skip.
// ──────────────────────────────────────────────────────────────────────────

async function mergeSegments(seg2: Settled, seg2OutputUrl: string): Promise<void> {
  if (!seg2.parent_history_id) return;
  const admin = createAdminClient();

  // Fetch parent (seg-1) row
  const { data: parent } = await admin
    .from("history")
    .select(
      "id, user_id, output_url, merged_url, metadata, status"
    )
    .eq("id", seg2.parent_history_id)
    .single();
  if (!parent) return;
  if (parent.merged_url) {
    console.log(`[segment-chain] parent ${parent.id} already merged, skipping`);
    return;
  }
  if (!parent.output_url) {
    console.log(`[segment-chain] parent ${parent.id} has no output_url yet, retry later`);
    return;
  }

  // Run merge
  const mergeRes = await falMergeVideos([parent.output_url, seg2OutputUrl]);
  if (!mergeRes.ok || !mergeRes.url) {
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: `Merge failed: ${mergeRes.error}`,
      })
      .eq("id", parent.id);
    return;
  }

  // Update parent: merged_url filled, output_url switched to merged so the
  // history grid shows the final 16s clip.
  await admin
    .from("history")
    .update({
      merged_url: mergeRes.url,
      output_url: mergeRes.url,
      thumbnail_url: mergeRes.url,
      metadata: {
        ...(parent.metadata || {}),
        seg1_url: parent.output_url, // preserve seg-1 url for debugging
        seg2_url: seg2OutputUrl,
        merged_at: new Date().toISOString(),
      },
    })
    .eq("id", parent.id);
}
