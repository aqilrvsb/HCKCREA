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

// Aligned with the slot-rotation cascade's 4-attempt walk (start →
// next → next → start again). 3 auto-retries + the original = 4 total
// settle attempts. Each retry re-fires through the cascade, so a row
// that fails on slot 1 gets up to 12 total provider attempts (3 retries
// × 4 cascade walks) before giving up. After exhaustion the user can
// still manually retry from the UI.
const MAX_AUTO_RETRIES = 3;

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
  if (retryCount >= MAX_AUTO_RETRIES) return false;
  if (!hist.prompt) return false;

  const refImage = hist.reference_url || "";
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
  let newProvider: "p1" | "p2" | "p3" | "p4" | "p5" = "p2";
  let newSlot: string | undefined = undefined;
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
      imageUrls: refImage ? [refImage] : undefined,
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
    newModel = r.actualModel;
    fallbackUsed = r.fallbackUsed;
  } else if (isSeedance) {
    // Seedance: single P1 (GeminiGen) call, no cascade. Per user
    // direction, Cinema/Seedance always routes to p1 directly.
    const { p1CreateTask } = await import("@/lib/p1");
    const created = await p1CreateTask({
      model,
      prompt: retryPrompt,
      imageUrls: refImage ? [refImage] : [],
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
    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: hist.user_id,
      prompt: retryPrompt,
      imageUrls: refImage ? [refImage] : [],
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
    });
    tierLog = r.tierLog;
    if (!r.ok) {
      // Cascade exhausted all 3 tiers. Stamp tier_log on the row so the
      // user sees the full attempt history.
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
  const rowProvider: "p1" | "p2" | "p3" | "p4" | "p5" =
    metaProvider === "p5" || metaWebhookProvider === "p5"
      ? "p5"
      : metaProvider === "p4" || metaWebhookProvider === "p4"
        ? "p4"
        : metaProvider === "p3" || metaWebhookProvider === "p3"
          ? "p3"
          : metaProvider === "p1" || metaWebhookProvider === "p1"
            ? "p1"
            : "p2";
  let r: { status: "pending" | "running" | "succeeded" | "failed"; outputUrl?: string; error?: string; raw?: any };
  if (rowProvider === "p5") {
    const { p5GetStatus } = await import("@/lib/p5");
    r = await p5GetStatus(hist.task_id);
  } else if (rowProvider === "p4") {
    const { p4GetStatus } = await import("@/lib/p4");
    r = await p4GetStatus(hist.task_id);
  } else if (rowProvider === "p3") {
    const { p3GetStatus } = await import("@/lib/p3");
    r = await p3GetStatus(hist.task_id);
  } else {
    r = await p2GetStatus(hist.task_id, rowProvider as "p1" | "p2");
  }
  const admin = createAdminClient();

  if (r.status === "succeeded" && r.outputUrl) {
    const reason =
      hist.type === "image"
        ? "image_generate"
        : hist.tab === "cinema"
          ? "cinema"
          : hist.tab === "seedance"
            ? "seedance"
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
    // No auto-retry / cascade-fallback inside settle anymore. Polling
    // (cron, webhook, manual refresh icon) ONLY checks task status and
    // flips the row to done or failed. The user clicks the Resubmit
    // button on a failed row to fire a fresh cascade attempt (which
    // rotates to a different slot via skipSlot in retry route).
    await admin
      .from("history")
      .update({ status: "failed", error_message: errMsg })
      .eq("id", hist.id);
    return { state: "settled", status: "failed", error: r.error };
  }

  // Stale-pending guard: if the CURRENT task has been pending too
  // long, flip the row to failed. Time is measured from the LAST
  // submit (initial fire or Resubmit), not from the row's
  // created_at — otherwise a row that's resubmitted hours after the
  // original fire would immediately stale-fail before the new task
  // gets a chance.
  //
  // Precedence: metadata.task_started_at → metadata.retried_at →
  //             hist.updated_at → hist.created_at.
  //
  // Videos: 10 min cap. Images: 3 min cap.
  const meta: any = hist.metadata || {};
  const startedRef =
    meta.task_started_at ||
    meta.retried_at ||
    (hist as any).updated_at ||
    (hist as any).created_at;
  const ageMs = startedRef ? Date.now() - new Date(startedRef).getTime() : 0;
  const isImageRow =
    hist.tab === "image" ||
    hist.type === "image" ||
    hist.type === "fairytale-scene";
  const staleMs = isImageRow ? 3 * 60_000 : 10 * 60_000;
  if (ageMs > staleMs) {
    const staleMsg = `Stale — ${Math.round(ageMs / 60_000)} min pending, provider did not return result. Click Resubmit to try again.`;
    await admin
      .from("history")
      .update({ status: "failed", error_message: staleMsg })
      .eq("id", hist.id);
    return { state: "settled", status: "failed", error: staleMsg };
  }

  return { state: "pending", p2Status: r.status };
}
