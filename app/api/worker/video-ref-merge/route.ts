import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask, p2GetStatus } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { falMergeVideos } from "@/lib/fal";
import { rehostToContent } from "@/lib/b2";
import { deduct } from "@/lib/deduct";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/worker/video-ref-merge — drives multi-segment GeminiOmni Video
// Reference rows (metadata.videoRefMulti) to completion:
//   1. RECOVER: re-fire any segment left without a task_id (origin after()
//      died before firing). Capped by metadata.fire_attempts.
//   2. POLL: p2GetStatus each segment's task_id (all on p2-a = default key).
//   3. STITCH: when every segment succeeded → falMergeVideos in order →
//      rehost to B2 → deduct → mark the parent row done.
//   4. FAIL: if any segment failed for good → mark the parent failed.
//
// The parent row has task_id=null so poll-pending never touches it — this
// worker is the sole driver. Cron: */2. Auth: Bearer CRON_SECRET.

const GEMINI_MODEL = "google/gemini-omni";
const MAX_ROWS_PER_TICK = 5;
// Per-segment fire attempts. A transient Crun error retries on the OTHER
// p2 slot (p2-a ↔ p2-b) rather than failing the whole job.
const MAX_SEG_ATTEMPTS = 4;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .eq("tab", "original-video")
    .eq("status", "pending")
    .filter("metadata->>videoRefMulti", "eq", "true")
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS_PER_TICK);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Resolve Crun keys once. p2-a = default key; p2-b = keyB (falls back to
  // default when keyB isn't configured, so a retry still fires somewhere).
  const p2cfg = await getP2Config();
  const keyForSlot = (slot: string): string | undefined =>
    slot === "p2-b" && p2cfg.keyB ? p2cfg.keyB : undefined;

  const results: any[] = [];

  for (const row of rows) {
    try {
      const meta = (row.metadata || {}) as Record<string, any>;
      const segs: any[] = Array.isArray(meta.segments) ? meta.segments : [];
      if (segs.length === 0) continue;

      const imageUrls: string[] = Array.isArray(meta.image_urls) ? meta.image_urls : [];
      const refVideoUrl = String(meta.refVideoUrl || "");
      const aspectRatio = String(meta.aspectRatio || "9:16");

      // Fire (or re-fire) ONE segment on its current p2 slot; bumps attempts.
      const fireSeg = async (s: any) => {
        s.attempts = Number(s.attempts || 0) + 1;
        try {
          const r = await p2CreateTask({
            model: GEMINI_MODEL,
            userId: row.user_id,
            prompt: String(s.prompt || ""),
            imageUrls,
            videoUrls: [refVideoUrl],
            refVideoStart: Number(s.start) || 0,
            refVideoEnd: Number(s.ends) || (Number(s.start) || 0) + 10,
            aspectRatio,
            resolution: "1080p",
            forceP2: true,
            apiKeyOverride: keyForSlot(String(s.slot || "p2-a")),
          });
          if (r.ok && r.task_id) {
            s.task_id = String(r.task_id);
            s.status = "pending";
            s.error = null;
          } else {
            s.task_id = null;
            s.error = r.error || "create failed";
          }
        } catch (e: any) {
          s.task_id = null;
          s.error = e?.message || "create error";
        }
      };

      // 1) RECOVER — fire any pending segment still missing a task_id
      //    (origin after() died before firing, or a retry cleared it).
      for (const s of segs) {
        if (s.status !== "pending" || s.task_id || !refVideoUrl) continue;
        if (Number(s.attempts || 0) >= MAX_SEG_ATTEMPTS) {
          s.status = "failed";
          s.error = s.error || "max attempts reached";
          continue;
        }
        await fireSeg(s);
      }

      // 2) POLL — check each fired segment. A transient Crun failure retries
      //    on the OTHER p2 slot (p2-a ↔ p2-b) until MAX_SEG_ATTEMPTS.
      for (const s of segs) {
        if (!s.task_id || s.status !== "pending") continue;
        try {
          const st = await p2GetStatus(String(s.task_id), "p2", keyForSlot(String(s.slot || "p2-a")));
          if (st.status === "succeeded" && st.outputUrl) {
            s.status = "succeeded";
            s.output_url = st.outputUrl;
          } else if (st.status === "failed") {
            if (Number(s.attempts || 0) < MAX_SEG_ATTEMPTS) {
              // Flip slot + re-fire — the P2 A↔B cascade for this segment.
              s.slot = String(s.slot || "p2-a") === "p2-a" ? "p2-b" : "p2-a";
              s.task_id = null;
              s.error = st.error || "segment error (retrying)";
              await fireSeg(s);
            } else {
              s.status = "failed";
              s.error = st.error || "segment failed";
            }
          }
        } catch {
          /* transient poll error — retry next tick */
        }
      }

      const fireAttempts = segs.reduce((m, s) => Math.max(m, Number(s.attempts || 0)), 0);
      const done = segs.filter((s) => s.status === "succeeded").length;
      const failed = segs.filter((s) => s.status === "failed").length;

      // Persist segment progress (re-read to avoid clobber).
      const { data: fresh } = await admin
        .from("history")
        .select("status, metadata")
        .eq("id", row.id)
        .maybeSingle();
      if (!fresh || fresh.status !== "pending") {
        results.push({ id: row.id, skipped: "no longer pending" });
        continue;
      }
      const freshMeta = (fresh.metadata || {}) as Record<string, any>;

      // 4) FAIL — any segment permanently failed.
      if (failed > 0) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: `Segment gagal: ${segs.find((s) => s.status === "failed")?.error || "unknown"}`,
            metadata: { ...freshMeta, segments: segs, merge_status: "failed", fire_attempts: fireAttempts },
          })
          .eq("id", row.id);
        results.push({ id: row.id, outcome: "failed" });
        continue;
      }

      // 3) STITCH — all segments done → merge + rehost + deduct + settle.
      if (done === segs.length) {
        // Atomic-ish claim to avoid a concurrent tick double-merging.
        if (freshMeta.merge_status === "merging") {
          results.push({ id: row.id, skipped: "merging in progress" });
          continue;
        }
        await admin
          .from("history")
          .update({ metadata: { ...freshMeta, segments: segs, merge_status: "merging", fire_attempts: fireAttempts } })
          .eq("id", row.id)
          .eq("status", "pending");

        const clipUrls = segs.map((s) => String(s.output_url));
        const merge = await falMergeVideos(clipUrls);
        if (!merge.ok || !merge.url) {
          await admin
            .from("history")
            .update({ metadata: { ...freshMeta, segments: segs, merge_status: "segments_firing", fire_attempts: fireAttempts } })
            .eq("id", row.id);
          results.push({ id: row.id, outcome: "merge-retry", error: merge.error });
          continue;
        }

        const finalUrl = await rehostToContent({
          url: merge.url,
          userId: row.user_id,
          historyId: row.id,
          type: "cinema",
          fallbackExt: "mp4",
        });

        const cost = Number(freshMeta.segTotalCost || meta.segTotalCost || 0);
        if (cost > 0) {
          try {
            // "cinema" ledger reason (original-video family); amount is
            // passed explicitly so the label doesn't change the charge.
            await deduct(row.user_id, "cinema", cost, row.id);
          } catch {
            /* deduct best-effort — don't block the delivered video */
          }
        }

        await admin
          .from("history")
          .update({
            status: "done",
            cost,
            error_message: null,
            output_url: finalUrl,
            thumbnail_url: finalUrl,
            metadata: {
              ...freshMeta,
              segments: segs,
              merge_status: "done",
              merged_url: finalUrl,
              fire_attempts: fireAttempts,
            },
          })
          .eq("id", row.id);
        results.push({ id: row.id, outcome: "done" });
        continue;
      }

      // Still waiting on some segments — persist progress + move on.
      await admin
        .from("history")
        .update({ metadata: { ...freshMeta, segments: segs, merge_status: "segments_firing", fire_attempts: fireAttempts } })
        .eq("id", row.id);
      results.push({ id: row.id, outcome: "pending", done, total: segs.length });
    } catch (e: any) {
      results.push({ id: row.id, error: e?.message || "row error" });
    }
  }

  return NextResponse.json({ ok: true, processed: rows.length, results });
}
