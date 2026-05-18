// Resolve a single pending history row against P2 — used by both the
// browser-driven /api/generate/status route AND the Vercel Cron worker
// (/api/worker/poll-pending). Idempotent: only flips on the
// pending → done|failed transition, deduct fires once.
//
// Side-effect on success: also auto-saves the prompt to saved_prompts so the
// user's library builds up with every generation. Idempotent — only inserts
// once per history_id (history_id has FK so duplicate inserts are caught by
// the dedupe check).

import { createAdminClient } from "@/lib/supabase/admin";
import { p2GetStatus, p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { deduct, priceFor, type PriceModelHint } from "@/lib/deduct";
import { onSegmentSettled } from "@/lib/segment-chain";
import { generateUgcPostMeta } from "@/lib/ugc-post-meta";
import { uploadFromUrlToContent, buildKey, type StorageType } from "@/lib/b2";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import {
  getVideoFallbackSlots,
  getGrokFallbackSlots,
  getCinemaFallbackSlots,
  getImageFallbackSlots,
  type CascadeAsset,
} from "@/lib/cascade-rotation";

// Map a model string (from history.metadata.model) to a per-model rate
// hint. Used at settle time so the live admin rate (rate_<model>) is
// applied even if the row was inserted before the rate was changed.
// Returns undefined when we can't recognise the model — caller falls
// back to the row's stored cost in that case.
function inferModelHint(model?: string | null): PriceModelHint | undefined {
  const m = String(model || "").toLowerCase();
  if (!m) return undefined;
  if (m.includes("seedance")) return "seedance";
  if (m.includes("grok")) return "grok";
  if (m.includes("veo")) return "veo";
  if (m.includes("nano-banana") || m.includes("banana")) return "banana_pro";
  if (m.includes("gpt-image")) return "gpt_image";
  return undefined;
}

// ── B2 auto-upload helpers ────────────────────────────────────────────
// Every successful generation gets rehosted to our peninglab-content B2
// bucket so the file lives on infrastructure we control (consistent CDN,
// 30-day lifecycle via B2 rule, immutable cache headers baked into the
// bucket config). Replaces output_url with the S3-style B2 URL on
// success — keeps the provider URL on failure so the row is never broken.

function storageTypeForHistory(hist: HistoryRow): StorageType | null {
  // Match the layout in lib/b2.ts → buildKey: users/{userId}/{type}/{id}.{ext}
  if (hist.type === "image") return "image";
  if (hist.type === "fairytale-scene") return "fairytale-scene";
  if (hist.type === "fairytale") return "fairytale";
  if (hist.tab === "video" || hist.type === "video") return "ugc";
  if (hist.tab === "auto" || hist.type === "auto-content") return "auto";
  if (hist.tab === "cinema") return "cinema";
  if (hist.tab === "seedance") return "seedance";
  if (hist.tab === "clone" || hist.type === "clone") return "clone";
  return null;
}

function extFromUrl(url: string, fallback: string): string {
  const path = url.split("?")[0];
  const m = path.match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : fallback;
}

function contentTypeFor(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "mov") return "video/quicktime";
  return "application/octet-stream";
}

async function rehostOutputToB2(
  admin: ReturnType<typeof createAdminClient>,
  hist: HistoryRow,
  providerUrl: string
): Promise<void> {
  try {
    const sType = storageTypeForHistory(hist);
    if (!sType) return; // unknown row type → leave provider URL alone

    const isImage = sType === "image" || sType === "fairytale-scene";
    const fallbackExt = isImage ? "png" : "mp4";
    const ext = extFromUrl(providerUrl, fallbackExt);
    const key = buildKey({
      userId: hist.user_id,
      type: sType,
      historyId: hist.id,
      ext,
    });
    // Uses the SEPARATE B2_CONTENT_* credentials (scoped to peninglab-
    // content bucket). Returns the public S3 URL the bucket serves with
    // `cache-control: public, max-age=2592000, immutable` baked in.
    const { publicUrl: b2Url } = await uploadFromUrlToContent({
      url: providerUrl,
      key,
      contentType: contentTypeFor(ext),
    });

    await admin
      .from("history")
      .update({
        output_url: b2Url,
        thumbnail_url: hist.type === "video" || hist.type === "auto-content" ? b2Url : null,
      })
      .eq("id", hist.id);
  } catch (e: any) {
    console.warn(
      `[settle] B2 rehost failed for ${hist.id} (${hist.type}):`,
      e?.message || e
    );
    // Don't throw — the provider URL is still in DB, file will play
    // for as long as the provider keeps it (~7 days for Crun).
  }
}

export type HistoryRow = {
  id: string;
  user_id: string;
  type: string;
  tab?: string | null;
  status: string;
  task_id: string | null;
  duration?: number | null;
  cost?: number | string | null;
  // The fields below aren't always selected at every call site, but settle
  // reads the whole row when it can — these are best-effort for auto-save.
  prompt?: string | null;
  reference_url?: string | null;
  project_id?: string | null;
  metadata?: any;
  // Read for the stale-recovery branch — settle uses this to decide
  // whether a "failed" row was genuinely failed or just stale-cleaned.
  error_message?: string | null;
  // 16s + Extend chain fields (read by onSegmentSettled hook)
  segment_index?: number | null;
  parent_history_id?: string | null;
  frame_anchor?: string | null;
  output_url?: string | null;
  merged_url?: string | null;
};

// Map a history.tab value to the saved_prompts.bucket enum.
function bucketForTab(tab: string | null | undefined): string {
  switch (tab) {
    case "video":
    case "ugc":
      return "ugc";
    case "cinema":
      return "cinema";
    case "image":
      return "image";
    case "auto":
      return "auto";
    case "clone":
      return "ugc"; // clone outputs are UGC-style, library it under UGC
    default:
      return "ugc";
  }
}

// Insert into saved_prompts after a successful generation. Best-effort —
// failures here never break the settle path. Dedupes on history_id so the
// poll-worker hitting the same row twice can't create duplicates.
async function autoSavePrompt(
  admin: ReturnType<typeof createAdminClient>,
  hist: HistoryRow & { prompt?: string | null; reference_url?: string | null; project_id?: string | null; metadata?: any }
): Promise<void> {
  try {
    if (!hist.prompt || !hist.prompt.trim()) return;

    // Dedupe — if a row already exists for this history_id, skip
    const { data: existing } = await admin
      .from("saved_prompts")
      .select("id")
      .eq("history_id", hist.id)
      .maybeSingle();
    if (existing) return;

    const meta = hist.metadata || {};
    await admin.from("saved_prompts").insert({
      user_id: hist.user_id,
      project_id: hist.project_id || null,
      history_id: hist.id,
      prompt_text: hist.prompt,
      bucket: bucketForTab(hist.tab),
      model: meta.model || null,
      reference_url: hist.reference_url || null,
      duration: hist.duration ?? null,
      aspect_ratio: meta.aspectRatio || meta.aspect_ratio || null,
      cost: Number(hist.cost || 0),
      outcome: "success",
      source: "auto",
    });
  } catch {
    // Library is a nice-to-have; don't break the settle path on any error.
  }
}

// Errors we treat as transient provider hiccups — auto-retry up to MAX_AUTO_RETRIES
// before letting the row stay failed. The user-visible "Internal Error, Please
// try again later." string from RunningHub/Crun has been the dominant case
// blocking Auto Content batches; rate-limit / 5xx wording covered too.
// Auto-retry / cascade-fallback ONLY fires on internal-server-class
// errors per user direction. Rate-limits, timeouts, content moderation,
// or anything that isn't a clear "upstream broke" signal stays failed
// on first attempt — user can manually retry via the icon.
//
// Matches:
//   • "internal server error" / "Internal Server Error" (HTTP 500-class)
//   • bare "INTERNAL" (Crun's terse error code)
//   • "Service internal exception" (APIMart's phrasing)
//   • bare HTTP 500 / 502 / 503 / 504
const TRANSIENT_ERROR_PATTERNS = [
  /internal server/i,
  /\binternal\b/i,
  /\b50[0234]\b/,
];

// "The Google model was unable to generate audio for this request." —
// Veo's audio-gen failure. Distinct retry path: the dialog text in the
// prompt has TTS-hostile content (template leaks like "CTA LINE HERE:",
// em-dashes inside quoted dialog, alphanumeric units like "1.3KG",
// abbreviations like "COD"). Plain re-fire fails the same way; we
// sanitise the prompt FIRST then retry.
const AUDIO_GEN_FAIL_PATTERNS = [
  /unable to generate audio/i,
  /audio generation failed/i,
  /audio synthesis failed/i,
];

// Floor / ceiling for the dynamic auto-retry cap. The cap itself comes
// from the count of admin-configured fallback slots in the row's
// cascade pool (video/grok/cinema/image). Per user direction: when a
// task errors, immediately fire the next fallback retry; if that errors,
// fire the next one; until all fallback slots have been visited. This
// replaces the old hardcoded "3" with admin-driven configuration.
const MIN_AUTO_RETRIES = 1;
const MAX_AUTO_RETRIES_CEILING = 10;

// Compute the dynamic retry cap from the admin-configured fallback slots
// for the row's cascade pool. Cached per cascade asset so we don't hit
// Supabase 4× per row in a hot loop.
const _capCache = new Map<CascadeAsset | "image", number>();
async function getDynamicRetryCap(
  asset: CascadeAsset | "image"
): Promise<number> {
  if (_capCache.has(asset)) return _capCache.get(asset)!;
  let slots;
  if (asset === "image") slots = await getImageFallbackSlots();
  else if (asset === "grok") slots = await getGrokFallbackSlots();
  else if (asset === "cinema") slots = await getCinemaFallbackSlots();
  else slots = await getVideoFallbackSlots();
  const count = slots.filter((s) => s !== "none").length;
  const cap = Math.max(
    MIN_AUTO_RETRIES,
    Math.min(MAX_AUTO_RETRIES_CEILING, count)
  );
  _capCache.set(asset, cap);
  return cap;
}

function isTransientError(err: string | null | undefined): boolean {
  if (!err) return false;
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(err));
}

function isAudioGenFailure(err: string | null | undefined): boolean {
  if (!err) return false;
  return AUDIO_GEN_FAIL_PATTERNS.some((re) => re.test(err));
}

// Sanitise a Veo prompt that previously failed audio-gen. Targets the
// known-hostile patterns we've seen in production:
//
//   1. Template-leak text — "CTA LINE HERE:" placeholder that wasn't
//      replaced. Veo tries to speak the meta-instruction.
//   2. Structured timestamp markers in dialog — "0–2s:" / "2–6s:" /
//      "6–8s:" with em-dashes. Veo's TTS chokes on the punctuation.
//   3. Em-dashes inside quoted dialog — same root cause as #2.
//   4. Number+unit abbreviations — "1.3KG", "COD", "RM 47" without
//      spaces or with awkward casing.
//
// Sanitiser is purely additive to existing retry logic: if it finds any
// of these patterns it strips them. If the prompt was already clean,
// the sanitiser is a no-op and we still re-fire (Veo audio-gen is
// occasionally flaky for non-prompt reasons).
function sanitiseForAudioRetry(prompt: string): string {
  let p = prompt;
  // 1. Template leaks
  p = p.replace(/\bCTA LINE HERE:\s*/gi, "");
  p = p.replace(/\b\[?DIALOG (PLACEHOLDER|HERE)\]?:\s*/gi, "");
  // 2. Strip "0-2s:" / "2-6s:" / "6-8s:" timestamp markers (any dash type)
  //    inside the dialog. Replace with a space so the surrounding lines
  //    flow naturally.
  p = p.replace(/\b\d+\s*[-–—]\s*\d+\s*s\s*:\s*/gi, " ");
  // 3. Replace em-dash and en-dash inside quoted dialog with commas. We
  //    only target dashes that sit between two letters (likely inside
  //    speech), not the "—" used to separate prompt sections.
  p = p.replace(/(["'])([^"']{0,400}?)\1/g, (_m, q, body) =>
    q + body.replace(/\s*[—–]\s*/g, ", ") + q
  );
  // 4. Number+unit abbreviations — expand the most common ones so TTS
  //    has something pronounceable. "1.3KG" → "1.3 kilogram",
  //    "COD" → "cash on delivery", "RM 47" stays but loses tight kerning.
  p = p.replace(/(\d+(?:\.\d+)?)\s*(KG|kg)\b/g, "$1 kilogram");
  p = p.replace(/(\d+(?:\.\d+)?)\s*(ML|ml)\b/g, "$1 mililiter");
  p = p.replace(/\bCOD\b/g, "cash on delivery");
  p = p.replace(/\bDM\b/g, "direct message");
  // Trim any double-spaces the substitutions created
  p = p.replace(/[ \t]{2,}/g, " ").replace(/\n[ \t]+/g, "\n");
  return p;
}

// Re-fire the same row's task against the dispatcher when the previous attempt
// failed with a transient error. Same semantics as /api/history/retry but
// invoked automatically. Returns true if a retry was successfully kicked off
// (row is now back in pending), false otherwise.
async function tryAutoRetry(
  admin: ReturnType<typeof createAdminClient>,
  hist: HistoryRow,
  errMsg: string
): Promise<boolean> {
  const meta = (hist.metadata || {}) as Record<string, any>;
  const retryCount = Number(meta.retry_count || 0);
  if (!hist.prompt) return false;

  // Determine the row's cascade asset so we can read the right fallback
  // pool to compute the per-row retry cap. Same detection rules used by
  // the cron worker (auto-resubmit) — kept in sync so both paths use
  // the same cap for any given row.
  const rowModel = String(meta.model || "");
  const isImageRowForCap =
    hist.tab === "image" ||
    hist.type === "image" ||
    hist.type === "fairytale-scene";
  let cascadeAsset: CascadeAsset | "image";
  if (isImageRowForCap) cascadeAsset = "image";
  else if (hist.tab === "seedance") cascadeAsset = "cinema";
  else if (
    hist.tab === "cinema" &&
    (meta.modelChoice === "grok" || /grok/i.test(rowModel))
  ) {
    cascadeAsset = "grok";
  } else {
    cascadeAsset = "video";
  }
  const dynamicCap = await getDynamicRetryCap(cascadeAsset);
  if (retryCount >= dynamicCap) return false;

  const refImage = hist.reference_url || "";
  // BUG FIX: previously this branch only passed `refImage` (the first
  // attachment) which dropped the 2nd/3rd product/avatar refs for
  // multi-attachment auto-content + UGC rows. Now reads the full
  // `meta.image_urls` array the wizard stamped on submit, falling back
  // to refImage only for legacy rows that predate the array stamp.
  // Cron worker + manual retry route already do this correctly; this
  // sync brings event-driven retry in line.
  const allImageUrls: string[] =
    Array.isArray(meta.image_urls) && meta.image_urls.length > 0
      ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : refImage
        ? [refImage]
        : [];
  const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
  const durationMode: "8" | "16" = hist.duration === 16 ? "16" : "8";
  const imageMode: "frame" | "ingredient" | "text" =
    meta.imageMode === "frame" || meta.imageMode === "ingredient"
      ? meta.imageMode
      : refImage
        ? "ingredient"
        : "text";

  let model = String(meta.model || "");
  if (!model) {
    const cfg = await getP2Config();
    if (hist.tab === "image" || hist.type === "image") {
      model = String(meta.image_model || cfg.imageDefault || "google/nano-banana-pro");
    } else if (hist.tab === "cinema") {
      model = refImage ? cfg.grokI2V : cfg.grokT2V;
    } else {
      model = refImage ? cfg.videoR2V : cfg.videoT2V;
    }
  }

  // For audio-gen failures, run the prompt through the sanitiser so we
  // strip the patterns Veo's TTS chokes on (template leaks, em-dashes
  // in dialog, alphanumeric units). For transient errors, prompt is
  // unchanged — the failure was provider-side, not prompt-side.
  const audioFail = isAudioGenFailure(errMsg);
  const retryPrompt = audioFail
    ? sanitiseForAudioRetry(hist.prompt)
    : hist.prompt;

  // Route to the right cascade based on row type:
  //   • image / fairytale-scene → image cascade (p2 ↔ p4 bidirectional)
  //   • seedance               → direct p2 call (no cascade; Seedance is
  //                              one specific p2 model with no key-B
  //                              fallback equivalent)
  //   • everything else (Veo + Grok across UGC / Auto Content / Cinema /
  //     Talking Object / Extend / AI agent) → video cascade (p2-A → p2-B)
  const isImageRow =
    hist.tab === "image" ||
    hist.type === "image" ||
    hist.type === "fairytale-scene";
  const isSeedance = model.toLowerCase().includes("seedance");

  let newTaskId: string | null = null;
  let newProvider: "p1" | "p2" | "p3" | "p4" | "p5" | "p6" = "p2";
  let newSlot: string | undefined = undefined;
  let newKeyIndex: number | undefined = undefined;
  let newModel: string = model;
  let fallbackUsed = false;
  let tierLog: any = undefined;

  if (isImageRow) {
    const primaryProvider: "p2" | "p3" | "p4" =
      meta.primary_provider === "p4" || meta.provider === "p4"
        ? "p4"
        : meta.primary_provider === "p3" || meta.provider === "p3"
          ? "p3"
          : "p2";
    const r = await generateImageWithCascade({
      primaryProvider,
      primaryModel: model.replace(/^google\//, "").replace(/^openai\//, ""),
      primaryModelP2: model,
      prompt: retryPrompt,
      aspectRatio,
      // Pass ALL attachments, not just refImage. Multi-ref image gen
      // (banana with 2-3 product photos) needs every URL or the
      // retry drops the extras.
      imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
      retry: true,
    });
    tierLog = r.tierLog;
    if (!r.ok) {
      // Cascade exhausted all 3 tiers. Stamp tier_log on the row so the
      // user can see "tried p2, p1, p3 — all failed" instead of guessing.
      await admin
        .from("history")
        .update({
          metadata: {
            ...meta,
            tier_log: tierLog,
            last_retry_error: r.error.slice(0, 300),
            last_retry_at: new Date().toISOString(),
            retry_count: retryCount + 1,
          },
        })
        .eq("id", hist.id);
      return false;
    }
    newTaskId = r.taskId;
    newProvider = r.actualProvider;
    newSlot = r.actualSlot;
    newKeyIndex = (r as any).keyIndex;
    newModel = r.actualModel;
    fallbackUsed = r.fallbackUsed;
  } else if (isSeedance) {
    // Seedance: single P1 (GeminiGen) call, no cascade. Per user
    // direction, Cinema/Seedance always routes to p1 directly.
    const { p1CreateTask } = await import("@/lib/p1");
    const created = await p1CreateTask({
      model,
      prompt: retryPrompt,
      // Pass ALL attachments (multi-ref Seedance needs every URL).
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
    });
    if (!created.ok || !created.task_id) return false;
    newTaskId = created.task_id;
    newProvider = "p1";
  } else {
    // Video cascade for UGC / Auto / Cinema Veo / Talking Object / Extend.
    // Auto-retry must skip tiers that previously accepted but failed
    // downstream during polling — otherwise we'd just re-fire the same
    // broken tier and waste the retry budget. Read the prior tier_log
    // and bump past the highest ok tier.
    // Find the slot that previously accepted at create-time but failed
    // during polling — push it last in the cascade walk so we don't
    // re-fire the same broken backend. tier_log format: "1:p2-a:model".
    const priorLog: Array<{ tier?: string; ok?: boolean }> = Array.isArray(
      meta.tier_log
    )
      ? meta.tier_log
      : [];
    let skipSlot: any = undefined;
    for (const entry of priorLog) {
      if (!entry?.ok) continue;
      const parts = String(entry.tier || "").split(":");
      if (parts.length >= 2) skipSlot = parts[1];
    }
    if (skipSlot) {
      console.warn(
        `[settle/auto-retry] row ${hist.id}: slot ${skipSlot} previously accepted at create but failed during polling — pushing to end of walk`
      );
    }
    // Pass the row's cascade asset (video/grok/cinema) so the fallback
    // round-robin uses the same pool family. cascadeAsset is detected at
    // the top of this function; here it's narrowed to non-image values.
    const videoAsset: "video" | "grok" | "cinema" =
      cascadeAsset === "image" ? "video" : cascadeAsset;
    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: hist.user_id,
      prompt: retryPrompt,
      // Pass ALL attachments (multi-ref Veo r2v needs every URL — was
      // silently truncated to 1 image on event-driven retries before).
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
      retry: true,
      asset: videoAsset,
    });
    tierLog = r.tierLog;
    if (!r.ok) {
      // Cascade exhausted all fallback tiers. Stamp tier_log on the row
      // so the user sees the full attempt history.
      await admin
        .from("history")
        .update({
          metadata: {
            ...meta,
            tier_log: tierLog,
            last_retry_error: r.error.slice(0, 300),
            last_retry_at: new Date().toISOString(),
            retry_count: retryCount + 1,
            // Sync auto_resubmit_count with retry_count so the cron sees
            // the same exhaustion state event-driven retries reached.
            auto_resubmit_count: Math.max(
              Number(meta.auto_resubmit_count || 0),
              retryCount + 1
            ),
          },
        })
        .eq("id", hist.id);
      return false;
    }
    newTaskId = r.taskId;
    newProvider = r.actualProvider;
    newSlot = r.actualSlot;
    newKeyIndex = (r as any).keyIndex;
    newModel = r.actualModel;
    fallbackUsed = r.fallbackUsed;
  }

  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: newTaskId,
      // If we sanitised the prompt, persist the new version so future
      // recheck / extend operations use the cleaner text.
      ...(audioFail ? { prompt: retryPrompt } : {}),
      error_message: null,
      metadata: {
        ...meta,
        provider: newProvider,
        slot: newSlot,
        ...(typeof newKeyIndex === "number" ? { p6_key_index: newKeyIndex } : { p6_key_index: undefined }),
        model: newModel,
        fallback_used: fallbackUsed,
        tier_log: tierLog,
        retried_at: new Date().toISOString(),
        retry_count: retryCount + 1,
        last_retry_error: errMsg.slice(0, 200),
        last_retry_kind: audioFail ? "auto-audio-fix" : "auto",
      },
    })
    .eq("id", hist.id);
  return true;
}

export type SettleResult =
  | { state: "settled"; status: "done" | "failed"; outputUrl?: string; error?: string }
  | { state: "pending"; p2Status: string }
  | { state: "skipped"; reason: string };

export async function settleHistoryRow(hist: HistoryRow): Promise<SettleResult> {
  // Genuine done rows never re-settle — output already produced + credit
  // already deducted.
  if (hist.status === "done") {
    return { state: "skipped", reason: "already settled" };
  }

  // Failed rows are usually genuine failures, but stale-cleanup
  // (poll-pending forces 'failed' after 10 min when neither webhook nor
  // cron landed in time) creates rows that look failed even though the
  // upstream provider may have completed the job. We allow re-settling
  // those: if the original task_id is still present and the row was
  // never marked `done`, give it one more shot — credit deduction is
  // gated on the row not already being `done`, so re-settling can't
  // double-charge.
  if (hist.status === "failed") {
    const isStale = String(hist.error_message || "").startsWith("Stale");
    const hasOutput = !!hist.output_url;
    if (!isStale || hasOutput) {
      return { state: "skipped", reason: "already settled" };
    }
    // Fall through — re-query upstream and recover if it succeeded.
  }

  if (!hist.task_id) {
    return { state: "skipped", reason: "no task_id" };
  }

  // Pick the backend the row was originally created on. Two metadata keys
  // may carry the provider tag depending on which insert path created the
  // row: `provider` is set by the original dispatcher; `webhook_provider`
  // is stamped by the extend/seg2/segment-chain inserts (those rows go
  // through a different code path that historically only wrote
  // webhook_provider). Prefer either — explicit value wins.
  // Defaults to p2 if neither is set (legacy rows from before multi-provider).
  // p3 = Mountsea (Storytelling-only, opt-in via admin setting).
  const metaProvider = String(hist.metadata?.provider || "").toLowerCase();
  const metaWebhookProvider = String(
    hist.metadata?.webhook_provider || ""
  ).toLowerCase();
  const rowProvider: "p1" | "p2" | "p3" | "p4" | "p5" | "p6" =
    metaProvider === "p6" || metaWebhookProvider === "p6"
      ? "p6"
      : metaProvider === "p5" || metaWebhookProvider === "p5"
        ? "p5"
        : metaProvider === "p4" || metaWebhookProvider === "p4"
          ? "p4"
          : metaProvider === "p3" || metaWebhookProvider === "p3"
            ? "p3"
            : metaProvider === "p1" || metaWebhookProvider === "p1"
              ? "p1"
              : "p2";
  let r: { status: "pending" | "running" | "succeeded" | "failed"; outputUrl?: string; error?: string; raw?: any };
  if (rowProvider === "p6") {
    const { p6GetStatus } = await import("@/lib/p6");
    const slot = hist.metadata?.slot as any;
    // image vs video endpoint — APIPod scopes them on different paths
    const isImageRow =
      hist.tab === "image" ||
      hist.type === "image" ||
      hist.type === "fairytale-scene";
    r = await p6GetStatus(
      hist.task_id,
      typeof slot === "string" && slot.startsWith("p6-") ? (slot as any) : undefined,
      isImageRow ? "image" : "video"
    );
  } else if (rowProvider === "p5") {
    const { p5GetStatus } = await import("@/lib/p5");
    r = await p5GetStatus(hist.task_id);
  } else if (rowProvider === "p4") {
    const { p4GetStatus } = await import("@/lib/p4");
    r = await p4GetStatus(hist.task_id);
  } else if (rowProvider === "p3") {
    const { p3GetStatus } = await import("@/lib/p3");
    r = await p3GetStatus(hist.task_id);
  } else {
    // If this row was fired through slot p2-b, poll with key B —
    // Crun scopes task IDs per account so key A returns empty for
    // tasks submitted via key B.
    let apiKeyOverride: string | undefined;
    if (rowProvider === "p2" && hist.metadata?.slot === "p2-b") {
      const { getP2Config } = await import("@/lib/settings");
      const cfg = await getP2Config();
      if (cfg.keyB) apiKeyOverride = cfg.keyB;
    }
    r = await p2GetStatus(hist.task_id, rowProvider as "p1" | "p2", apiKeyOverride);
  }
  const admin = createAdminClient();

  if (r.status === "succeeded" && r.outputUrl) {
    // 16s clip billing: charge per-segment, NOT the full 16s rate
    // upfront. Seg-1 of a 16s chain bills as video_8s (its half),
    // seg-2 also bills as video_8s. Total = 2 × video_8s only when
    // both segments succeed. If seg-2 fails, user only paid for the
    // 8s they actually got — fair pricing.
    const is16sSeg1 =
      hist.segment_index === 1 &&
      (hist.metadata as any)?.duration_mode === "16s";
    const reason =
      hist.type === "image"
        ? "image_generate"
        : hist.tab === "cinema"
          ? "cinema"
          : hist.tab === "seedance"
            ? "seedance"
            : is16sSeg1
              ? "video_8s"
              : hist.duration === 16
                ? "video_16s"
                : "video_8s";

    // Live cost at the moment of settlement. Inspect the row's recorded
    // model to pick the per-model rate (rate_<model> in app_settings),
    // multiply by duration for per-second models, and use that as the
    // deduct amount. Falls back to the row's stored cost only when we
    // can't infer the model — keeps backward compat with rows from
    // before this wiring landed.
    const modelHint = inferModelHint(hist.metadata?.model);
    let chargeAmount = Number(hist.cost || 0);
    if (modelHint) {
      const baseRate = await priceFor(hist.user_id, reason as any, modelHint);
      const durationSec = Number(hist.duration) || 8;
      // Grok + Seedance bill per second; Veo + image models are flat.
      const liveRate =
        modelHint === "grok" || modelHint === "seedance"
          ? Number((baseRate * durationSec).toFixed(4))
          : Number(baseRate.toFixed(4));
      // Only override the row's stored cost when we got a positive rate
      // back. priceFor can return 0 when no rate is configured for this
      // (reason, modelHint) pair (e.g. cinema + veo without admin setting)
      // — in that case fall back to the cost the route stamped at insert.
      if (liveRate > 0) chargeAmount = liveRate;
    }

    if (chargeAmount > 0) {
      await deduct(hist.user_id, reason as any, chargeAmount, hist.id);
    }

    await admin
      .from("history")
      .update({
        status: "done",
        output_url: r.outputUrl,
        thumbnail_url: hist.type === "video" ? r.outputUrl : null,
        // Persist the actual charged amount so admin reports show what
        // the user was billed (not the stale insert-time estimate).
        cost: chargeAmount,
        // Wipe any stale error text the row picked up before recovery
        // (e.g. "Stale — exceeded 10m without resolution").
        error_message: null,
      })
      .eq("id", hist.id);

    // Auto-rehost the freshly-produced output to our peninglab-content B2
    // bucket. Replaces output_url with the S3 URL so the file lives on
    // our CDN with consistent caching + 30-day B2 lifecycle TTL, instead
    // of dangling on the provider's CDN where it expires after ~7 days.
    // Best-effort — keeps provider URL on any failure.
    await rehostOutputToB2(admin, hist, r.outputUrl);

    // Auto-save the prompt to the user's library. Best-effort — a failure
    // here never breaks the generation path.
    await autoSavePrompt(admin, hist);

    // Segment chain hook — for 16s clips and Extend chains. If this row is
    // seg-1 of a 16s clip, fires seg-2. If it's seg-2 (or an Extend
    // continuation), merges with the parent. No-op for everything else.
    // Best-effort — chain failure never breaks the settle path.
    await onSegmentSettled({ ...hist, output_url: r.outputUrl }, r.outputUrl).catch(
      (e) => console.error("[settle] onSegmentSettled threw:", e)
    );

    // UGC auto-meta — fire-and-forget. When a UGC video row finishes,
    // generate caption + 5 hashtags + cover_title + cover_subtitle so
    // the extension's auto-post step has a complete payload without
    // requiring the user to click "Generate caption + cover" by hand.
    // Auto Content already has these stamped at master-plan generation,
    // so we skip those rows. Skip seg-1 of a 16s chain (seg-2 will trigger
    // onSegmentSettled → merge → meta lands on the merged row instead).
    const isUgcRow = hist.tab === "video";
    const isSeg1 = hist.segment_index === 1 && !hist.parent_history_id;
    if (isUgcRow && !isSeg1) {
      void generateUgcPostMeta(hist.id, { force: false }).catch((e) =>
        console.error("[settle] generateUgcPostMeta threw:", e)
      );
    }

    return { state: "settled", status: "done", outputUrl: r.outputUrl };
  }

  if (r.status === "failed") {
    const errMsg = r.error || "Generation failed";

    // EVENT-DRIVEN AUTO-RETRY: when a task fails, immediately fire a
    // fresh retry through the FALLBACK cascade pool — no waiting for the
    // 8-min cron tick. Walks one fallback slot per retry; auto_resubmit_
    // count caps the loop at the number of fallback slots admin configured
    // in the cascade UI (per-asset: video/grok/cinema). After all
    // fallbacks exhausted, the row stays failed and the cron becomes a
    // pure safety net for cases where settle.ts itself never ran.
    //
    // Per user direction: "if error, it auto go to fallback 1; if error
    // again, fallback two; until finish cascade". Previously only
    // fairytale-scene rows did this; now ALL video tabs (UGC / Auto
    // Content / Cinema / Talking Object / Extend / AI agent /
    // storytelling-scene) get the immediate retry path.
    const isAutoRetryable =
      hist.type === "fairytale-scene" ||
      hist.type === "video" ||
      hist.type === "auto-content" ||
      hist.tab === "video" ||
      hist.tab === "auto" ||
      hist.tab === "cinema" ||
      hist.tab === "seedance";
    if (isAutoRetryable) {
      const retried = await tryAutoRetry(admin, hist, errMsg);
      if (retried) {
        console.log(
          `[settle] row ${hist.id} (${hist.tab}/${hist.type}) auto-retried on fallback slot after failure: ${errMsg.slice(0, 120)}`
        );
        // Row is back in pending — the next poll cycle will settle it.
        // Don't mark failed yet.
        return { state: "pending", p2Status: "pending" };
      }
      console.warn(
        `[settle] row ${hist.id} (${hist.tab}/${hist.type}) auto-retry exhausted, leaving failed: ${errMsg.slice(0, 120)}`
      );
    }

    // No auto-retry / cascade-fallback inside settle for non-storytelling
    // rows. Polling (cron, webhook, manual refresh icon) ONLY checks
    // task status and flips the row to done or failed. The user clicks
    // the Resubmit button on a failed row to fire a fresh cascade
    // attempt (which rotates to a different slot via skipSlot in
    // retry route).
    await admin
      .from("history")
      .update({ status: "failed", error_message: errMsg })
      .eq("id", hist.id);
    return { state: "settled", status: "failed", error: r.error };
  }

  // No logic-based stale auto-fail. Cron / webhook / refresh icon all
  // simply ask the upstream what the real status is and trust the
  // answer. If a task is genuinely stuck on the upstream's queue
  // forever, that's an upstream bug, not ours — the user can click
  // Resubmit to fire a new task on a different slot.
  return { state: "pending", p2Status: r.status };
}
