import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";

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
const LOOKBACK_HOURS = 6;
const BATCH_LIMIT = 20;

// Patterns that count as "internal server" / "Crun/Veo upstream broke"
// — the only failure class auto-resubmit covers. Content moderation,
// audio-gen-failed, rate-limit, etc. stay manual.
const INTERNAL_SERVER_PATTERNS = [
  /\binternal\b/i,            // "INTERNAL" (Crun terse), "Internal Server Error"
  /\b50[0234]\b/,             // 500/502/503/504
  /service internal/i,        // APIMart phrasing
  /server exception/i,        // Crun phrasing
  /please resend/i,           // APIMart hint
];

function isInternalServerError(err: string | null | undefined): boolean {
  if (!err) return false;
  return INTERNAL_SERVER_PATTERNS.some((re) => re.test(err));
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60_000).toISOString();

  const { data: rows, error } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, prompt, reference_url, duration, cost, metadata, error_message, updated_at"
    )
    .eq("status", "failed")
    .in("tab", ["video", "auto", "auto-content"])
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: "fetch failed", detail: error.message }, { status: 500 });
  }

  const cfg = await getP2Config();
  const summary = { scanned: 0, eligible: 0, resubmitted: 0, exhausted: 0, ineligible: 0 };

  for (const row of rows || []) {
    summary.scanned += 1;
    if (!isInternalServerError(row.error_message)) {
      summary.ineligible += 1;
      continue;
    }
    const meta = (row.metadata || {}) as Record<string, any>;
    const autoCount = Number(meta.auto_resubmit_count || 0);
    if (autoCount >= MAX_AUTO_RESUBMIT) {
      summary.exhausted += 1;
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

    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: row.user_id,
      prompt: row.prompt,
      imageUrls: allImageUrls,
      durationMode,
      aspectRatio,
      imageMode,
      skipSlot,
    });

    if (!r.ok) {
      // Stamp the auto-attempt so we don't retry the same failed
      // upstream forever, but keep status=failed (didn't recover).
      await admin
        .from("history")
        .update({
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

    await admin
      .from("history")
      .update({
        status: "pending",
        task_id: r.taskId,
        error_message: null,
        metadata: {
          ...meta,
          provider: r.actualProvider,
          slot: r.actualSlot,
          model: r.actualModel,
          fallback_used: r.fallbackUsed,
          tier_log: r.tierLog,
          retried_at: new Date().toISOString(),
          auto_resubmit_count: autoCount + 1,
          auto_resubmit_last_attempt_at: new Date().toISOString(),
          last_retry_kind: "auto-internal-server",
        },
      })
      .eq("id", row.id);
    summary.resubmitted += 1;
  }

  return NextResponse.json({ ok: true, ...summary, ts: new Date().toISOString() });
}
