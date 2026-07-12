import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { filterVisibleToClient } from "@/lib/server-history-visibility";
import {
  getVideoFallbackSlots,
  getGrokFallbackSlots,
  getCinemaFallbackSlots,
  getSora2FallbackSlots,
  getGeminiFallbackSlots,
  type CascadeAsset,
} from "@/lib/cascade-rotation";
import { isInternalError } from "@/lib/retry-eligibility";
import { recoverFlaggedImage } from "@/lib/flagged-image";

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
//   • tab IN ('video', 'auto', 'auto-content', 'cinema', 'seedance',
//             'clone', 'template-body')   ← video gens + Kling motion-control
//     (template-body re-fires through the Kling cascade, not the video one)
//   • status = 'failed'
//   • error_message matches internal-server pattern
//   • metadata.auto_resubmit_count < MAX_AUTO_RESUBMIT (3)
//   • updated_at within the last 6 hours (don't auto-retry ancient rows)
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.

// MAX_AUTO_RESUBMIT is no longer a hardcoded number. It's computed
// per-row from the actual count of non-"none" fallback slots in the
// row's cascade pool (video/grok/cinema) — so if admin configured 5
// fallback slots for VIDEO CASCADE, video rows auto-retry up to 5
// times. If they configured 1, only 1 retry. Sensible floor of 1 +
// hard ceiling of 10 to prevent runaway loops on misconfigurations.
const MIN_AUTO_RESUBMIT_CAP = 1;
const MAX_AUTO_RESUBMIT_CAP = 10;

async function getAutoRetryCap(asset: CascadeAsset): Promise<number> {
  let slots;
  if (asset === "grok") slots = await getGrokFallbackSlots();
  else if (asset === "cinema") slots = await getCinemaFallbackSlots();
  else if (asset === "sora2") slots = await getSora2FallbackSlots();
  else if (asset === "gemini") slots = await getGeminiFallbackSlots();
  else slots = await getVideoFallbackSlots();
  // Count active slots only — "none" entries are placeholders, not
  // real retry destinations.
  const activeCount = slots.filter((s) => s !== "none").length;
  return Math.max(
    MIN_AUTO_RESUBMIT_CAP,
    Math.min(MAX_AUTO_RESUBMIT_CAP, activeCount)
  );
}

const LOOKBACK_HOURS = 24;
const BATCH_LIMIT = 30;

// Auto-resubmit policy: INTERNAL-ERROR-ONLY allow-list. Per user
// direction: "all the logic resubmit is...only for internal error".
// The shared isInternalError() helper in lib/retry-eligibility.ts is
// the single source of truth — same gate used by event-driven settle,
// admin Resubmit, and the admin errors feed filter.
//
// Anything else (content moderation, audio-gen, rate-limit, validator,
// auth, etc.) is a permanent failure from the cron's POV — user sees
// it on their own dashboard and resolves it manually (rewrite prompt,
// wait out rate limit, etc.). Cron never touches it.

function isRetryable(err: string | null | undefined): boolean {
  return isInternalError(err);
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
    .in("tab", ["video", "auto", "auto-ugc", "auto-content", "cinema", "original-video", "seedance", "clone", "template-body"])
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

  // Cache per-asset caps so we don't hit Supabase 3× per cron tick
  // (one per asset, even though the same rows reuse the same asset).
  const capCache = new Map<CascadeAsset, number>();
  async function capFor(asset: CascadeAsset): Promise<number> {
    if (!capCache.has(asset)) {
      capCache.set(asset, await getAutoRetryCap(asset));
    }
    return capCache.get(asset)!;
  }

  for (const row of rows || []) {
    summary.scanned += 1;
    if (!isRetryable(row.error_message)) {
      summary.ineligible += 1;
      continue;
    }
    const meta = (row.metadata || {}) as Record<string, any>;
    const autoCount = Number(meta.auto_resubmit_count || 0);

    // ---- Template Body (Kling motion-control) ----------------------------
    // Kling rows re-fire through their OWN cascade (klingCreateWithCascade),
    // not generateVideoWithCascade — they need the motion video + orientation
    // + mode that the video cascade knows nothing about. Retry cap = number
    // of configured kling slots.
    if (row.tab === "template-body") {
      const { getKlingSlots, klingCreateWithCascade } = await import("@/lib/kling");
      const kSlots = await getKlingSlots();
      const kCap = Math.max(MIN_AUTO_RESUBMIT_CAP, Math.min(MAX_AUTO_RESUBMIT_CAP, kSlots.length || 1));
      if (autoCount >= kCap) { summary.exhausted += 1; continue; }

      const { data: kClaimed, error: kClaimErr } = await admin
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
      if (kClaimErr || !kClaimed || kClaimed.length === 0) { summary.ineligible += 1; continue; }
      summary.eligible += 1;

      // Prefer the green-screened avatar we built at first generation so the
      // retry keeps the clean chroma-key background.
      const imageUrl = (meta.green_image_url as string) || (meta.image_url as string) || row.reference_url || "";
      const videoUrl = (meta.motion_url as string) || "";
      if (!imageUrl || !videoUrl) {
        // The original refs are gone (e.g. B2 TTL) — can't re-fire. Revert.
        await admin.from("history").update({
          status: "failed",
          error_message: "Auto-resubmit skipped: motion/avatar reference missing",
          metadata: { ...meta, auto_resubmit_count: autoCount + 1 },
        }).eq("id", row.id);
        continue;
      }

      const kr = await klingCreateWithCascade({
        userId: row.user_id,
        imageUrl,
        videoUrl,
        prompt: row.prompt || undefined,
        mode: meta.mode === "std" ? "std" : "pro",
        characterOrientation: meta.character_orientation === "image" ? "image" : "video",
        keepOriginalSound: meta.keep_original_sound === true,
      });

      if (!kr.ok) {
        await admin.from("history").update({
          status: "failed",
          error_message: kr.error || "Auto-resubmit failed",
          metadata: {
            ...meta,
            auto_resubmit_count: autoCount + 1,
            auto_resubmit_last_attempt_at: new Date().toISOString(),
            auto_resubmit_last_error: kr.error?.slice(0, 200),
          },
        }).eq("id", row.id);
        continue;
      }

      await admin.from("history").update({
        task_id: kr.taskId,
        metadata: {
          ...meta,
          provider: "kling",
          slot: kr.slot,
          tier_log: kr.tierLog,
          retried_at: new Date().toISOString(),
          task_started_at: new Date().toISOString(),
          auto_resubmit_count: autoCount + 1,
          auto_resubmit_last_attempt_at: new Date().toISOString(),
          last_retry_kind: "auto-internal-server",
        },
      }).eq("id", row.id);
      summary.resubmitted += 1;
      continue;
    }

    // Determine the row's cascade asset (same logic used later when
    // firing the actual retry — match the row's original pool).
    const rowModel = String(meta.model || "");
    let rowAsset: CascadeAsset = "video";
    if (row.tab === "sora2") rowAsset = "sora2";
    else if (meta.modelChoice === "sora2" || /sora/i.test(rowModel)) {
      // Auto Content Sora 2 rows (tab='auto', modelChoice='sora2')
      // also route through the sora2 pool for retries.
      rowAsset = "sora2";
    }
    else if (meta.modelChoice === "gemini" || /gemini-omni/i.test(rowModel)) {
      // GeminiOmni rows (Original Video / Auto Content Omni) route through
      // the dedicated gemini cascade pool — NOT the generic video pool,
      // which may include p6 slots that don't accept google/gemini-omni.
      // This branch was MISSING here, so Omni rows defaulted to the Veo
      // 'video' pool and re-failed every retry. lib/settle.ts already had
      // it; this brings the cron in sync. Fixed 2026-06-29.
      rowAsset = "gemini";
    }
    else if (row.tab === "seedance") rowAsset = "cinema";
    else if (meta.modelChoice === "seedance" || /seedance/i.test(rowModel)) {
      // Original Video Seedance rows are tab='original-video' — route by
      // modelChoice through the cinema pool. Matches lib/settle.ts.
      rowAsset = "cinema";
    }
    else if (meta.modelChoice === "grok" || /grok/i.test(rowModel)) {
      // Grok by modelChoice/model REGARDLESS of tab — Dialog UGC grok rows
      // are tab="video", so the old tab gate misrouted them to the Veo
      // 'video' pool → "Missing Params or Type Error". Fixed 2026-06-19.
      rowAsset = "grok";
    }
    else if (row.tab === "original-video" && meta.modelChoice === "veo") {
      // Original Video Veo rows retry through the video cascade pool.
      rowAsset = "video";
    }
    const rowCap = await capFor(rowAsset);

    if (autoCount >= rowCap) {
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
    let allImageUrls: string[] = Array.isArray(meta.image_urls) && meta.image_urls.length > 0
      ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : (refImage ? [refImage] : []);
    // Content-policy recovery: if the row failed because APIPod blocked a
    // specific reference image ("image reference N blocked: previously
    // flagged by content policy"), drop THAT image so this cron resubmit
    // re-fires without it — a per-image md5 flag can't be rotated around.
    // meta.image_urls is updated so both writes below (which spread ...meta)
    // persist the reduced set for subsequent attempts.
    const flaggedFix = await recoverFlaggedImage({
      errMsg: row.error_message,
      imageUrls: allImageUrls,
      meta,
      userId: row.user_id,
      historyId: row.id,
    });
    if (flaggedFix) {
      allImageUrls = flaggedFix.urls;
      console.log(`[auto-resubmit] row ${row.id}: ${flaggedFix.action} flagged image reference ${flaggedFix.index + 1} → ${flaggedFix.detail}`);
    }
    // GeminiOmni Video Reference source — carry it so the cron resubmit
    // re-runs video→video with the same reference + all attachments.
    const refVideoUrl = String(meta.videoRef || "").trim();
    const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
    // Preserve the ORIGINAL duration (Veo 8/16, Grok 1-15s, Sora 8/12).
    // Old `=== 16 ? "16" : "8"` downgraded a 15s Grok job to 8s on retry.
    const durationMode: string = String(row.duration || 8);
    const imageMode: "frame" | "ingredient" | "text" =
      meta.imageMode === "frame" || meta.imageMode === "ingredient"
        ? meta.imageMode
        : refImage
          ? "ingredient"
          : "text";
    // Resolve the model. Prefer the stamped meta.model (grok/omni/sora rows
    // carry it). When empty, fall back BY modelChoice so a grok/omni row
    // without a stamped model doesn't silently retry as Veo. Mirrors
    // lib/settle.ts. Fixed 2026-06-29.
    let model = String(meta.model || "");
    if (!model) {
      if (meta.modelChoice === "gemini") model = "google/gemini-omni";
      else if (meta.modelChoice === "sora2") model = "sora2";
      else if (meta.modelChoice === "seedance") model = "seedance";
      else if (meta.modelChoice === "grok") model = refImage ? cfg.grokI2V : cfg.grokT2V;
      else model = refImage ? cfg.videoR2V : cfg.videoT2V;
    }

    // Force the cascade to a slot different from the last-failed one.
    const priorLog: any[] = Array.isArray(meta.tier_log) ? meta.tier_log : [];
    let skipSlot: any = meta.slot;
    if (!skipSlot) {
      const last = priorLog[priorLog.length - 1];
      const parts = String(last?.tier || "").split(":");
      if (parts.length >= 2) skipSlot = parts[1];
    }

    // Asset already detected at the top of the loop (rowAsset) so the
    // retry cap could be computed from the matching cascade pool. Reuse
    // it here for the actual generateVideoWithCascade call.

    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: row.user_id,
      prompt: row.prompt,
      imageUrls: allImageUrls,
      refVideoUrl: refVideoUrl || undefined,
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
      retry: true,
      asset: rowAsset,
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
