import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { filterVisibleToClient } from "@/lib/server-history-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/worker/auto-resubmit
//
// Vercel-cron-driven background worker. Every 5 minutes, scans
// recently-failed UGC + Auto Content rows whose failure was caused by
// an upstream internal-server error and silently re-fires them
// through the video cascade. Counter advances → lands on a different
// slot than the one that failed.
//
// Scope (deliberately narrow):
//   • tab IN ('video', 'auto', 'auto-content')   ← UGC + Auto Content
//   • status = 'failed'
//   • error_message matches internal-server pattern
//   • metadata.auto_resubmit_count < MAX_AUTO_RESUBMIT (3)
//   • updated_at within the last 6 hours (don't auto-retry ancient rows)
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.

const MAX_AUTO_RESUBMIT = 3;
const LOOKBACK_HOURS = 24;
const BATCH_LIMIT = 30;

// Auto-resubmit policy: RETRY BY DEFAULT, skip only on explicit
// non-retryable patterns. Previously the cron used a narrow
// "retryable allowlist" which silently skipped generic messages like
// "Unknown error. Please contact support." or "Generation failed" —
// admin had to clean them up manually.
//
// MAX_AUTO_RESUBMIT still caps each row at 3 attempts so a genuinely
// permanent failure can't loop forever even if its message doesn't
// match any no-retry pattern.
const NO_RETRY_PATTERNS = [
  // Content moderation — re-running same prompt will hit the same block
  /moderation|content[- ]policy|safety[- ]filter|blocked content/i,
  // Rate-limited — backoff doesn't help inside an 8-min window
  /rate[- ]?limit|too many requests|quota exceeded/i,
  // Audio gen failures on Veo — model-side bug, re-running same prompt fails again
  /audio[- ]?gen|audio generation/i,
  // CUE validator / schema validation — bad request, won't fix itself
  /CUE validator|validation failed|invalid model id/i,
  // Config issues — admin needs to fix, not the cron
  /not configured|missing.*key|key.*not found/i,
  // Credit / quota out — user / billing problem
  /insufficient (quota|credits|balance)|not enough credit/i,
  // Auth — provider rejected our key, retry won't help
  /unauthorized|forbidden|invalid api key|api key.*invalid/i,
];

function isRetryable(err: string | null | undefined): boolean {
  // No error_message at all → don't retry (we have no signal)
  if (!err) return false;
  // Matches a non-retryable pattern → skip
  if (NO_RETRY_PATTERNS.some((re) => re.test(err))) return false;
  // Default → RETRY. Generic "Unknown error", "Generation failed",
  // "INTERNAL", etc. all go through. MAX_AUTO_RESUBMIT caps the loop.
  return true;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60_000).toISOString();

  const { data: rawRows, error } = await admin
    .from("history")
    .select(
      "id, user_id, project_id, type, tab, status, prompt, reference_url, duration, cost, metadata, error_message, updated_at, created_at"
    )
    .eq("status", "failed")
    // All video-producing tabs. Image tabs ("image", "fairytale") use
    // a different cascade and are handled separately — for now they
    // stay manual until image-cascade auto-retry is wired up.
    .in("tab", ["video", "auto", "auto-content", "cinema", "seedance", "clone"])
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: "fetch failed", detail: error.message }, { status: 500 });
  }

  // Drop rows the client can't see anymore (TTL-expired + unsaved).
  // Hard-deleted rows are already absent from the SELECT above.
  // Without this, the cron could resubmit a row the user has
  // effectively abandoned (e.g. abandoned 2-week-old failure).
  const rows = await filterVisibleToClient(rawRows || []);
  const hiddenSkipped = (rawRows?.length || 0) - rows.length;

  const cfg = await getP2Config();
  const summary = {
    scanned: 0,
    eligible: 0,
    resubmitted: 0,
    exhausted: 0,
    ineligible: 0,
    hidden_skipped: hiddenSkipped,
  };

  for (const row of rows || []) {
    summary.scanned += 1;
    if (!isRetryable(row.error_message)) {
      summary.ineligible += 1;
      continue;
    }
    const meta = (row.metadata || {}) as Record<string, any>;
    const autoCount = Number(meta.auto_resubmit_count || 0);
    if (autoCount >= MAX_AUTO_RESUBMIT) {
      summary.exhausted += 1;
      continue;
    }

    // ATOMIC CLAIM: flip status failed → pending and stamp a fresh
    // task_started_at so:
    //   (a) The next cron tick won't re-pick this row (status now pending).
    //   (b) A simultaneous user click on Resubmit will see status !== "failed"
    //       and bail out (retry route's status check). Prevents duplicate fires.
    // If the update returns 0 rows, someone else got here first → skip.
    const { data: claimed, error: claimErr } = await admin
      .from("history")
      .update({
        status: "pending",
        error_message: null,
        metadata: {
          ...meta,
          auto_resubmit_count: autoCount + 1,
          auto_resubmit_last_attempt_at: new Date().toISOString(),
          task_started_at: new Date().toISOString(),
          last_retry_kind: "auto-internal-server",
        },
      })
      .eq("id", row.id)
      .eq("status", "failed")
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) {
      // Race lost — another worker / user click already claimed it.
      summary.ineligible += 1;
      continue;
    }
    summary.eligible += 1;

    const refImage = row.reference_url || "";
    const allImageUrls: string[] = Array.isArray(meta.image_urls) && meta.image_urls.length > 0
      ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : (refImage ? [refImage] : []);
    const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
    const durationMode: "8" | "16" = row.duration === 16 ? "16" : "8";
    const imageMode: "frame" | "ingredient" | "text" =
      meta.imageMode === "frame" || meta.imageMode === "ingredient"
        ? meta.imageMode
        : refImage
          ? "ingredient"
          : "text";
    const model = String(meta.model || (refImage ? cfg.videoR2V : cfg.videoT2V));

    // Force the cascade to a slot different from the last-failed one.
    const priorLog: any[] = Array.isArray(meta.tier_log) ? meta.tier_log : [];
    let skipSlot: any = meta.slot;
    if (!skipSlot) {
      const last = priorLog[priorLog.length - 1];
      const parts = String(last?.tier || "").split(":");
      if (parts.length >= 2) skipSlot = parts[1];
    }

    // Match the row's original cascade pool so the fallback rotation
    // stays in the right family (Grok rows → grok cascade, Seedance
    // rows → cinema cascade, everything else → video cascade).
    let asset: "video" | "grok" | "cinema" = "video";
    if (row.tab === "seedance") asset = "cinema";
    else if (
      row.tab === "cinema" &&
      (meta.modelChoice === "grok" || /grok/i.test(model))
    ) {
      asset = "grok";
    }

    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: row.user_id,
      prompt: row.prompt,
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
      retry: true,
      asset,
    });

    if (!r.ok) {
      // Cascade failed — revert status back to failed so the user
      // sees the Resubmit button again. Stamp the auto-error so we
      // don't loop forever on the same broken upstream.
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: r.error || "Auto-resubmit failed",
          metadata: {
            ...meta,
            auto_resubmit_count: autoCount + 1,
            auto_resubmit_last_attempt_at: new Date().toISOString(),
            auto_resubmit_last_error: r.error?.slice(0, 200),
          },
        })
        .eq("id", row.id);
      continue;
    }

    // Cascade accepted — stamp the new task_id + slot. Status stays
    // 'pending' (already set by the claim above) so the row appears
    // as Generating again on the dashboard.
    await admin
      .from("history")
      .update({
        task_id: r.taskId,
        metadata: {
          ...meta,
          provider: r.actualProvider,
          slot: r.actualSlot,
          ...((r as any).keyIndex !== undefined ? { p6_key_index: (r as any).keyIndex } : { p6_key_index: undefined }),
          model: r.actualModel,
          fallback_used: r.fallbackUsed,
          tier_log: r.tierLog,
          retried_at: new Date().toISOString(),
          task_started_at: new Date().toISOString(),
          auto_resubmit_count: autoCount + 1,
          auto_resubmit_last_attempt_at: new Date().toISOString(),
          last_retry_kind: "auto-internal-server",
        },
      })
      .eq("id", row.id);
    summary.resubmitted += 1;
  }

  // Heartbeat — stamp the last successful cron run so admin tools can
  // verify Vercel is actually firing the schedule. Key shows in the
  // admin Settings page's app_settings table.
  const ts = new Date().toISOString();
  try {
    await admin
      .from("app_settings")
      .upsert(
        {
          key: "last_auto_resubmit_run",
          value: { at: ts, ...summary },
          description: "Heartbeat from /api/worker/auto-resubmit cron.",
          category: "internal",
        },
        { onConflict: "key" }
      );
  } catch {}

  return NextResponse.json({ ok: true, ...summary, ts });
}
