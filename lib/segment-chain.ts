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
import { uploadFromUrl, signedGetUrl, buildKey, rehostToContent, type StorageType } from "@/lib/b2";
import { buildVeoLocks } from "@/lib/veo-voices";
import { refineFrameWithProduct } from "@/lib/refine-frame";

// Rehost a (possibly expired) Crun temp video URL to B2 so fal can fetch
// it during the merge step. Returns a fresh 7-day signed URL on success,
// or null if the source URL is dead. Used by mergeSeg1AndSeg2 to handle
// old parent rows whose seg-1 output_url has aged past Crun's TTL.
async function rehostStaleSegToB2(
  url: string,
  userId: string,
  historyId: string
): Promise<string | null> {
  if (!url) return null;
  try {
    // Fast HEAD check — if the URL still works, no need to rehost.
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return url;
  } catch {
    // ignore — fall through to rehost
  }
  try {
    const key = buildKey({ userId, type: "video", historyId, ext: "mp4" });
    await uploadFromUrl({ url, key, contentType: "video/mp4" });
    return await signedGetUrl({ key });
  } catch (e: any) {
    console.warn(
      `[segment-chain] rehost-to-B2 failed for ${url.slice(0, 80)}:`,
      e?.message || e
    );
    return null;
  }
}

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

// Single source of truth for the Veo lock block is lib/veo-voices.ts
// buildVeoLocks. seg-2 reads hijab off parent metadata so the tudung stays on
// across the seg-1 → seg-2 cut.
function appendLocks(
  corePrompt: string,
  voiceLine?: string,
  hijab?: boolean
): string {
  return `${corePrompt.trim()}${buildVeoLocks({ voiceLine, hijab })}`;
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

  // Stamp chain progress markers on parent.metadata as we go through
  // the steps — the dashboard's segment placeholder reads
  // metadata.chain_phase to show the user which sub-step is running
  // (extract / refine / fire). Without these markers the user just
  // sees "Seg 2 generating…" for 60-120s with no idea what's
  // happening server-side.
  async function stampPhase(phase: string, extra: Record<string, any> = {}) {
    try {
      const { data: cur } = await admin
        .from("history")
        .select("metadata")
        .eq("id", parent.id)
        .maybeSingle();
      const curMeta = (cur?.metadata as Record<string, any>) || {};
      await admin
        .from("history")
        .update({
          metadata: {
            ...curMeta,
            chain_phase: phase,
            chain_phase_at: new Date().toISOString(),
            ...extra,
          },
        })
        .eq("id", parent.id);
    } catch (e) {
      console.warn(`[segment-chain] stampPhase ${phase} failed`, e);
    }
  }

  await stampPhase("extracting_last_frame");

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
  let anchorFrameUrl = frameRes.url;
  let refineUsed = false;
  let refineProvider: string | null = null;

  // 1b. BANANA REFINE — combine (last frame + product image) via
  // nano-banana-pro so the product in the start frame for seg-2 is
  // pixel-sharp. Cascade tries p4 → p2 → p6-a/b/c → p5 → p1 → p3 —
  // every provider runs nano-banana-pro specifically. NEVER falls
  // back to a different model and NEVER accepts the raw frame.
  // If ALL providers fail, the seg-2 fire is aborted and the parent
  // is marked failed so the user can manually retry.
  //
  // Source for the product image, in order of preference:
  //   metadata.image_urls[0] (Auto Content's full attachment array)
  //   metadata.product_image_url (from manual extend bodies)
  //   parent.reference_url (legacy single-ref rows)
  const productImageUrl =
    (Array.isArray(meta.image_urls) && meta.image_urls[0]) ||
    meta.product_image_url ||
    parent.reference_url ||
    "";
  if (productImageUrl) {
    await stampPhase("refining_with_banana");
    try {
      const refined = await refineFrameWithProduct({
        frameUrl: anchorFrameUrl,
        productUrl: productImageUrl,
        aspectRatio: meta.aspectRatio || "9:16",
      });
      if (refined.ok) {
        anchorFrameUrl = refined.url;
        refineUsed = true;
        refineProvider = refined.provider || null;
        console.log(
          `[segment-chain] frame refined via ${refined.provider}/nano-banana-pro for parent ${parent.id}`
        );
      } else {
        // ALL refine tiers failed — abort seg-2. User can retry from
        // the failed-card to fire a fresh refine + seg-2 attempt.
        // tierLog stamps which providers were tried + their error so
        // admin can see why the whole cascade fell over (e.g. all
        // p6 keys 429'd, or Banana Pro upstream had a brownout).
        console.warn(
          `[segment-chain] Banana refine ALL tiers failed for parent ${parent.id}:`,
          refined.error,
          refined.tierLog
        );
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: `Seg-2 refine failed on all Banana Pro tiers: ${refined.error}`,
            metadata: {
              ...meta,
              refine_failed_at: new Date().toISOString(),
              refine_tier_log: refined.tierLog,
            },
          })
          .eq("id", parent.id);
        return;
      }
    } catch (e: any) {
      // Refine threw an exception (network blip, etc.) — also abort
      // rather than fall back to raw. User retries from failed card.
      console.warn(
        `[segment-chain] Banana refine threw for parent ${parent.id}:`,
        e?.message || e
      );
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: `Seg-2 refine threw: ${e?.message || e}`,
        })
        .eq("id", parent.id);
      return;
    }
  }

  // 2. Build seg-2 prompt with all continuity locks
  const characterLock = String(meta.character_lock || "").trim();
  const seg2Body = String(meta.seg2_prompt || "").trim();
  const voiceLine = String(meta.voice_line || "");
  const productTextLock = productTextLockBlock(meta.product_ocr);
  // Pull hijab from parent metadata so seg-2's lock block matches seg-1.
  // Auto Content writes meta.hijab = true/false; agent UGC writes "yes"/"no".
  const isHijab =
    meta.hijab === true ||
    meta.hijab === "yes" ||
    meta.hijab === "hijab" ||
    meta.avatar_hijab === "hijab";

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

  // seg2_body is now ALREADY the full prompt with locks (built by
  // auto-content/route.ts veoSeg2PromptFor via swapDialogBlock —
  // shot 1's full prompt with only the dialog block replaced). For
  // legacy rows where seg2_body was just a partial prompt, the older
  // appendLocks path still works — but in the new code path, locks
  // are already present, so we skip the double-append.
  const seg2HasLocks =
    /DIALOG LENGTH LOCK:|ANATOMY LOCK:|AUDIO LOCK:/.test(seg2Body);
  const compose = [seg2Body];
  if (!seg2HasLocks && characterLock) compose.push(characterLock);
  if (!seg2HasLocks && productTextLock) compose.push(productTextLock);
  const seg2Prompt = seg2HasLocks
    ? seg2Body
    : appendLocks(compose.join("\n\n"), voiceLine || undefined, isHijab);

  await stampPhase("firing_veo_i2v");

  // 3. Fire seg-2 — use the SAME multi-attachments from seg-1 PLUS
  // the refined anchor frame as the start frame. Veo treats
  // imageUrls[0] as the primary visual anchor — we put the refined
  // last frame there for seamless continuity with seg-1's last frame.
  // The user's other product attachments (slots 2 and 3) come after
  // so the product anchoring stays consistent across the merged clip.
  // Per-model cap is enforced by the cascade slot's CreateVideo.
  const parentExtraImgs: string[] = Array.isArray(meta.image_urls)
    ? meta.image_urls.filter(
        (u: any) => typeof u === "string" && u.trim() && u !== anchorFrameUrl
      )
    : [];
  const seg2ImageUrls = [anchorFrameUrl, ...parentExtraImgs.slice(0, 2)];

  const cfg = await getP2Config();
  const created = await p2CreateTask({
    model: cfg.videoR2V,
    userId: parent.user_id,
    prompt: seg2Prompt,
    imageUrls: seg2ImageUrls,
    durationMode: "8",
    aspectRatio: meta.aspectRatio || "9:16",
    imageMode: "ingredient",
    skipR2VTriplicate: true,
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
      // Track whether the start frame went through the Banana refine
      // step so admin tooling can see why some seg-2's look sharper
      // than others. Useful for debugging product-drift complaints.
      refine_used: refineUsed,
      refine_provider: refineProvider,
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

  // Fetch parent (seg-1) row — tab is needed to pick the B2 storage
  // type (ugc / auto / cinema) when rehosting the merged output.
  const { data: parent } = await admin
    .from("history")
    .select(
      "id, user_id, tab, output_url, merged_url, metadata, status"
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

  // Stale-URL rehost. Old parent rows (>14d) often have expired Crun
  // tempfile.aiquickdraw.com URLs that fal can no longer download — the
  // merge then succeeds technically but with black/silent frames where
  // seg-1 should be. HEAD-check first; if dead, copy to B2 and use the
  // signed URL. If the source is genuinely gone (404 / connection
  // refused), the rehost fails and we surface a clean error instead of
  // silently merging black video.
  const seg1ForMerge = await rehostStaleSegToB2(
    parent.output_url,
    parent.user_id,
    parent.id
  );
  if (!seg1ForMerge) {
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message:
          "Seg-1 video URL expired and source is no longer reachable. Re-generate the original clip and try again.",
      })
      .eq("id", parent.id);
    return;
  }

  // Run merge
  const mergeRes = await falMergeVideos([seg1ForMerge, seg2OutputUrl]);
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

  // Rehost the fal merge output to peninglab-content so the 16s clip
  // lives on our B2 with cache-control + S3 URL, same as every other
  // generation. Falls back to the fal URL if rehost fails.
  const sType: StorageType =
    parent.tab === "auto" ? "auto" : parent.tab === "cinema" ? "cinema" : "ugc";
  const rehosted = await rehostToContent({
    url: mergeRes.url,
    userId: parent.user_id,
    historyId: parent.id,
    type: sType,
    fallbackExt: "mp4",
  });

  // Update parent: merged_url filled, output_url switched to merged so the
  // history grid shows the final 16s clip.
  await admin
    .from("history")
    .update({
      merged_url: rehosted,
      output_url: rehosted,
      thumbnail_url: rehosted,
      metadata: {
        ...(parent.metadata || {}),
        seg1_url: parent.output_url, // preserve seg-1 url for debugging
        seg2_url: seg2OutputUrl,
        merged_at: new Date().toISOString(),
      },
    })
    .eq("id", parent.id);
}
