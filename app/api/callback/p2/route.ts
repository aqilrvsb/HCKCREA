import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p2?secret=<CALLBACK_SECRET>
// Crun.ai webhook receiver — fires the moment a task changes status,
// no polling needed. The same payload shape the TaskInfo query returns
// is delivered here.
//
// Auth model: a per-environment secret in the query string (set via
// CALLBACK_SECRET env var). The submit route stitches this into the
// callback_url it passes to Crun, so only payloads originating from
// our own submissions can settle a row.
//
// We DON'T trust the body's status field directly — we look up the
// history row by task_id and re-verify with P2's TaskInfo via the
// shared settleHistoryRow helper. This means a spoofed webhook with
// wrong status data still results in correct settlement, and we stay
// idempotent because settle skips already-done rows.
//
// Crun retries failed deliveries, so we always reply 200 unless the
// secret check fails (then 401). 200-on-no-row is intentional.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (!process.env.CALLBACK_SECRET || secret !== process.env.CALLBACK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, note: "Invalid JSON" });
  }

  const taskId =
    body?.data?.task_id ||
    body?.task_id ||
    body?.data?.id ||
    null;

  if (!taskId) {
    return NextResponse.json({ ok: true, note: "No task_id in payload" });
  }

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .select("*")
    .eq("task_id", String(taskId))
    .maybeSingle();

  if (!hist) {
    // Could be from a different deployment, or task we never tracked.
    // Returning 200 prevents Crun from retrying forever.
    return NextResponse.json({ ok: true, note: "No matching history row" });
  }

  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
