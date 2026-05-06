import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Pro limit

// GET /api/worker/poll-pending
//
// Background worker. Mirrors the manual refresh-icon path 1:1 — fetches
// every pending row that has a task_id, calls settleHistoryRow on each,
// and lets the upstream provider's status drive the outcome:
//   - succeeded  → row flips done, credits deduct, library auto-save
//   - failed     → row flips failed with the upstream error_message
//   - pending    → row stays pending (next tick re-checks)
//
// No artificial stale-fail. If a row truly never resolves upstream
// (provider lost the task), it stays pending until the user clicks the
// refresh icon — which runs the exact same settleHistoryRow logic and
// can recover the row if upstream eventually returns succeeded.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We
// reject anything else.

const BATCH = 50; // max rows per cron tick — keeps the function under 60s

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Skip rows that just inserted (5s grace) so we don't race the create
  // call's own UPDATE that stamps the task_id.
  const cutoffYoungIso = new Date(Date.now() - 5_000).toISOString();

  const { data: rows, error: fetchErr } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, task_id, duration, cost, prompt, reference_url, project_id, metadata, error_message, created_at, segment_index, parent_history_id, frame_anchor, output_url, merged_url"
    )
    .eq("status", "pending")
    .not("task_id", "is", null)
    .lte("created_at", cutoffYoungIso)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (fetchErr) {
    return NextResponse.json(
      { error: "DB fetch failed", detail: fetchErr.message },
      { status: 500 }
    );
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

  return NextResponse.json({
    ok: true,
    scanned: rows?.length || 0,
    ...settled,
    ts: new Date().toISOString(),
  });
}
