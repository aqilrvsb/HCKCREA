import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p3?secret=<CALLBACK_SECRET>
//
// Mountsea webhook receiver. Mountsea's docs (docs.mountsea.ai) don't
// guarantee push callbacks — most installations rely on polling
// /gemini/task/result. We expose this endpoint anyway so:
//   • If Mountsea adds callback_url support later, we're ready.
//   • Test stubs / curl can poke this to force-settle a row.
//
// Auth: query-secret gate (same pattern as /api/callback/p1 + p2).
// We re-verify upstream via settleHistoryRow → p3GetStatus before
// flipping anything, so a spoofed body can't trick us.
//
// Always reply 200 (except on a failed secret check) so Mountsea
// doesn't retry-spam over rows we never tracked.

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

  // Mountsea task id can land under taskId / task_id / id.
  const taskId =
    body?.taskId ||
    body?.task_id ||
    body?.data?.taskId ||
    body?.data?.task_id ||
    body?.id ||
    null;
  if (!taskId) {
    return NextResponse.json({ ok: true, note: "No taskId in payload" });
  }

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .select("*")
    .eq("task_id", String(taskId))
    .maybeSingle();

  if (!hist) {
    return NextResponse.json({ ok: true, note: "No matching history row" });
  }

  // Stamp arrival metadata so /admin/webhook-log shows when Mountsea
  // actually delivered the callback (if it ever does).
  const event = String(body?.event || body?.status || "unknown");
  const nextMeta = {
    ...(hist.metadata || {}),
    webhook_received_at: new Date().toISOString(),
    webhook_event: event,
    webhook_provider: "p3",
  };
  await admin
    .from("history")
    .update({ metadata: nextMeta })
    .eq("id", hist.id);

  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
