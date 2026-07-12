import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { falMergeVideos } from "@/lib/fal";
import { rehostToContent } from "@/lib/b2";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/worker/video-ref-merge — drives multi-segment Video Reference
// jobs. Each job = one merge row (metadata.videoRefMerge) + N visible
// segment rows (metadata.videoRefSeg) linked via metadata.segIds.
//
//   • GATED round-robin firing: at most ONE gemini-omni job in flight PER
//     account (Crun caps concurrency → "Internal Error" otherwise). Fires
//     the next segment for an account only when that account is free.
//   • RETRY: a failed segment flips to the other p2 slot and re-fires (up
//     to MAX_SEG_ATTEMPTS) — the P2 A↔B cascade.
//   • Segments settle via the normal poll-pending/settle pipeline (each is
//     a real video card that deducts + rehosts on its own).
//   • MERGE: when every segment is done → falMergeVideos in order → rehost
//     → merge row done. Fails the merge if a segment exhausts retries.
//
// Cron: */2. Auth: Bearer CRON_SECRET.

const GEMINI_MODEL = "google/gemini-omni";
const MAX_ROWS_PER_TICK = 4;
const MAX_SEG_ATTEMPTS = 4;
const SLOTS = ["p2-a", "p2-b"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randStaggerMs = () => 3000 + Math.floor(Math.random() * 3000); // 3-6s

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: mergeRows } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .eq("tab", "original-video")
    .eq("status", "pending")
    .filter("metadata->>videoRefMerge", "eq", "true")
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS_PER_TICK);

  if (!mergeRows || mergeRows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const cfg = await getP2Config();
  const keyForSlot = (slot: string) => (slot === "p2-b" && cfg.keyB ? cfg.keyB : undefined);

  const results: any[] = [];

  for (const mrow of mergeRows) {
    try {
      const meta = (mrow.metadata || {}) as Record<string, any>;
      const segIds: string[] = Array.isArray(meta.segIds) ? meta.segIds : [];
      if (segIds.length === 0) {
        results.push({ id: mrow.id, skipped: "no segIds" });
        continue;
      }

      const { data: segRowsRaw } = await admin
        .from("history")
        .select("id, user_id, status, output_url, prompt, task_id, metadata")
        .in("id", segIds);
      const segRows = (segRowsRaw || []).sort(
        (a: any, b: any) => Number(a.metadata?.segIndex || 0) - Number(b.metadata?.segIndex || 0)
      );
      if (segRows.length === 0) {
        results.push({ id: mrow.id, skipped: "segments missing" });
        continue;
      }

      // Fire (or re-fire) one segment on its slot. Bumps seg_attempts.
      const fireSeg = async (sr: any, slot: string) => {
        const sm = (sr.metadata || {}) as Record<string, any>;
        const att = Number(sm.seg_attempts || 0) + 1;
        try {
          const r = await p2CreateTask({
            model: GEMINI_MODEL,
            userId: sr.user_id,
            prompt: String(sm.seg_prompt || sr.prompt || ""),
            videoUrls: [String(sm.refVideoUrl || meta.refVideoUrl || "")],
            refVideoStart: Number(sm.segStart) || 0,
            refVideoEnd: Number(sm.segEnd) || (Number(sm.segStart) || 0) + 10,
            aspectRatio: String(sm.aspectRatio || meta.aspectRatio || "9:16"),
            resolution: "1080p",
            forceP2: true,
            apiKeyOverride: keyForSlot(slot),
          });
          if (r.ok && r.task_id) {
            sr.task_id = String(r.task_id);
            sr.status = "pending";
            await admin
              .from("history")
              .update({
                task_id: String(r.task_id),
                status: "pending",
                error_message: null,
                metadata: { ...sm, slot, seg_attempts: att, seg_error: null },
              })
              .eq("id", sr.id);
          } else {
            await admin
              .from("history")
              .update({ metadata: { ...sm, slot, seg_attempts: att, seg_error: r.error || "create failed" } })
              .eq("id", sr.id);
          }
        } catch (e: any) {
          await admin
            .from("history")
            .update({ metadata: { ...sm, slot, seg_attempts: att, seg_error: e?.message || "create error" } })
            .eq("id", sr.id);
        }
      };

      // 1) RETRY — a failed segment flips slot + resets to pending (no task)
      //    so the gate re-fires it (up to MAX_SEG_ATTEMPTS).
      for (const sr of segRows) {
        if (sr.status !== "failed") continue;
        const sm = (sr.metadata || {}) as Record<string, any>;
        const att = Number(sm.seg_attempts || 0);
        if (att >= MAX_SEG_ATTEMPTS) continue; // permanent fail → merge fails below
        const newSlot = String(sm.slot || "p2-a") === "p2-a" ? "p2-b" : "p2-a";
        sr.status = "pending";
        sr.task_id = null;
        sr.metadata = { ...sm, slot: newSlot, seg_error: sr.metadata?.error || sm.seg_error || "retry" };
        await admin
          .from("history")
          .update({ status: "pending", task_id: null, error_message: null, metadata: sr.metadata })
          .eq("id", sr.id);
      }

      // 2) GATE + FIRE — for each account, if it's free (no in-flight
      //    segment: pending WITH a task_id), fire the next un-fired segment
      //    (pending, no task_id) assigned to it. Stagger the fires 3-6s.
      const toFire: { sr: any; slot: string }[] = [];
      for (const slot of SLOTS) {
        const slotSegs = segRows.filter((s: any) => String(s.metadata?.slot || "p2-a") === slot);
        const inFlight = slotSegs.find((s: any) => s.status === "pending" && s.task_id);
        if (inFlight) continue; // account busy
        const next = slotSegs.find(
          (s: any) =>
            s.status === "pending" &&
            !s.task_id &&
            Number(s.metadata?.seg_attempts || 0) < MAX_SEG_ATTEMPTS
        );
        if (next) toFire.push({ sr: next, slot });
      }
      for (let k = 0; k < toFire.length; k++) {
        await fireSeg(toFire[k].sr, toFire[k].slot);
        if (k < toFire.length - 1) await sleep(randStaggerMs());
      }

      // 3) DECIDE — merge when all done, fail if a segment exhausted retries.
      const permFailed = segRows.find(
        (s: any) => s.status === "failed" && Number(s.metadata?.seg_attempts || 0) >= MAX_SEG_ATTEMPTS
      );
      const allDone = segRows.every((s: any) => s.status === "done" && !!s.output_url);

      // Re-read merge row to avoid clobbering a concurrent tick.
      const { data: freshMerge } = await admin
        .from("history")
        .select("status, metadata")
        .eq("id", mrow.id)
        .maybeSingle();
      if (!freshMerge || freshMerge.status !== "pending") {
        results.push({ id: mrow.id, skipped: "merge not pending" });
        continue;
      }
      const fMeta = (freshMerge.metadata || {}) as Record<string, any>;

      if (permFailed) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: `Segment ${permFailed.metadata?.segIndex} gagal: ${permFailed.metadata?.seg_error || "unknown"}`,
            metadata: { ...fMeta, merge_status: "failed" },
          })
          .eq("id", mrow.id);
        results.push({ id: mrow.id, outcome: "failed" });
        continue;
      }

      if (allDone) {
        if (fMeta.merge_status === "merging") {
          results.push({ id: mrow.id, skipped: "merging" });
          continue;
        }
        await admin
          .from("history")
          .update({ metadata: { ...fMeta, merge_status: "merging" } })
          .eq("id", mrow.id)
          .eq("status", "pending");

        const clips = segRows.map((s: any) => String(s.output_url));
        const merge = await falMergeVideos(clips);
        if (!merge.ok || !merge.url) {
          await admin
            .from("history")
            .update({ metadata: { ...fMeta, merge_status: "waiting_segments" } })
            .eq("id", mrow.id);
          results.push({ id: mrow.id, outcome: "merge-retry", error: merge.error });
          continue;
        }
        const finalUrl = await rehostToContent({
          url: merge.url,
          userId: mrow.user_id,
          historyId: mrow.id,
          type: "cinema",
          fallbackExt: "mp4",
        });
        await admin
          .from("history")
          .update({
            status: "done",
            error_message: null,
            output_url: finalUrl,
            thumbnail_url: finalUrl,
            metadata: { ...fMeta, merge_status: "done", merged_url: finalUrl },
          })
          .eq("id", mrow.id);
        results.push({ id: mrow.id, outcome: "done" });
        continue;
      }

      const done = segRows.filter((s: any) => s.status === "done").length;
      results.push({ id: mrow.id, outcome: "pending", done, total: segRows.length });
    } catch (e: any) {
      results.push({ id: mrow.id, error: e?.message || "row error" });
    }
  }

  return NextResponse.json({ ok: true, processed: mergeRows.length, results });
}
