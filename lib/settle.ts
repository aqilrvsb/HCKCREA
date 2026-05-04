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
const TRANSIENT_ERROR_PATTERNS = [
  /internal error/i,
  /try again later/i,
  /rate limit/i,
  /timeout/i,
  /timed out/i,
  /\b50\d\b/,           // 500/502/503/504
  /service unavailable/i,
  /temporarily/i,
  /upstream/i,
];
const MAX_AUTO_RETRIES = 2;

function isTransientError(err: string | null | undefined): boolean {
  if (!err) return false;
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(err));
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

  const created = await p2CreateTask({
    model,
    userId: hist.user_id,
    prompt: hist.prompt,
    imageUrls: refImage ? [refImage] : [],
    durationMode,
    aspectRatio,
    imageMode,
  });

  if (!created.ok || !created.task_id) {
    // Auto-retry itself failed to dispatch — let the failed status stand
    // and surface the create error so the user can manually retry.
    return false;
  }

  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: created.task_id,
      error_message: null,
      metadata: {
        ...meta,
        provider: created.provider || meta.provider || "p2",
        retried_at: new Date().toISOString(),
        retry_count: retryCount + 1,
        last_retry_error: errMsg.slice(0, 200),
        last_retry_kind: "auto",
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
  // webhook_provider). Prefer either — whichever is "p1" wins. Defaults
  // to p2 if neither is set (legacy rows from before multi-provider).
  const metaProvider = String(hist.metadata?.provider || "").toLowerCase();
  const metaWebhookProvider = String(
    hist.metadata?.webhook_provider || ""
  ).toLowerCase();
  const rowProvider: "p1" | "p2" =
    metaProvider === "p1" || metaWebhookProvider === "p1" ? "p1" : "p2";
  const r = await p2GetStatus(hist.task_id, rowProvider);
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
      chargeAmount =
        modelHint === "grok" || modelHint === "seedance"
          ? Number((baseRate * durationSec).toFixed(4))
          : Number(baseRate.toFixed(4));
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
    // Transient provider errors (Internal Error / 5xx / rate limit / timeout)
    // get auto-retried up to MAX_AUTO_RETRIES before the row is left failed.
    if (isTransientError(errMsg)) {
      const retried = await tryAutoRetry(admin, hist, errMsg);
      if (retried) {
        return { state: "pending", p2Status: "auto_retry" };
      }
    }
    await admin
      .from("history")
      .update({ status: "failed", error_message: errMsg })
      .eq("id", hist.id);
    return { state: "settled", status: "failed", error: r.error };
  }

  return { state: "pending", p2Status: r.status };
}
