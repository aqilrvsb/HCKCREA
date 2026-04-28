import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Pro limit

// GET /api/worker/poll-pending
// Server-side background worker — wakes every minute via Vercel Cron and
// drains pending history rows by polling P2 for each. Replaces the Chrome
// extension's persistent service-worker pattern: even if the user closes
// the browser tab, this keeps marking videos done/failed and deducting
// credits, so when they come back the dashboard reflects reality.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Reject
// anything else so this route can't be hammered by random callers.
//
// Strategy:
//   - Pick max BATCH rows that are pending, have a task_id, and were
//     created < STALE_MIN minutes ago (avoid wasting calls on very-old
//     rows P2 has already garbage-collected).
//   - Settle them in parallel (P2 TaskInfo is independent per task).
//   - Stale cleanup: pending rows older than STALE_MIN are forced to
//     'failed' so the user isn't stuck on a "generating" spinner forever.

const BATCH = 50; // max rows per cron tick
const STALE_MIN = 5; // a pending row older than this many minutes is considered lost

export async function GET(req: Request) {
  // Authorize cron / admin caller
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const cutoffStaleIso = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const cutoffYoungIso = new Date(Date.now() - 5_000).toISOString(); // 5s after submit

  // Stage 1 — settle the rows that are young enough to still be alive on P2
  const { data: rows, error: fetchErr } = await admin
    .from("history")
    .select("id, user_id, type, tab, status, task_id, duration, cost, prompt, reference_url, project_id, metadata, created_at, segment_index, parent_history_id, frame_anchor, output_url, merged_url")
    .eq("status", "pending")
    .not("task_id", "is", null)
    .gte("created_at", cutoffStaleIso)
    .lte("created_at", cutoffYoungIso)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (fetchErr) {
    return NextResponse.json({ error: "DB fetch failed", detail: fetchErr.message }, { status: 500 });
  }

  const settled = { done: 0, failed: 0, pending: 0, errors: 0 };
  if (rows && rows.length > 0) {
    const results = await Promise.allSettled(
      rows.map((r) => settleHistoryRow(r as any))
    );
    for (const res of results) {
      if (res.status === "rejected") {
        settled.errors += 1;
        continue;
      }
      const v = res.value;
      if (v.state === "settled" && v.status === "done") settled.done += 1;
      else if (v.state === "settled" && v.status === "failed") settled.failed += 1;
      else settled.pending += 1;
    }
  }

  // Stage 2 — stale cleanup. Anything still pending beyond STALE_MIN gets
  // force-failed so the UI un-sticks. Don't deduct credits for these (no
  // output produced).
  const { data: stale } = await admin
    .from("history")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", cutoffStaleIso)
    .limit(200);

  let staleFailed = 0;
  if (stale && stale.length > 0) {
    const ids = stale.map((s) => s.id);
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: `Stale — exceeded ${STALE_MIN}m without resolution`,
      })
      .in("id", ids);
    staleFailed = ids.length;
  }

  return NextResponse.json({
    ok: true,
    scanned: rows?.length || 0,
    ...settled,
    stale_failed: staleFailed,
    ts: new Date().toISOString(),
  });
}
