import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p4?secret=<CALLBACK_SECRET>
//
// Grsai webhook receiver. We submit with webHook="-1" today so the
// platform falls back to polling /v1/draw/result on each settle cron
// tick — this endpoint exists so admins can opt into push callbacks
// later by setting webHook=<this-url> on submit.
//
// Auth: query-secret gate (same pattern as p1/p2/p3 callbacks).
// We re-verify upstream via settleHistoryRow → p4GetStatus before
// flipping anything, so a spoofed body can't trick us.

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

  // Grsai's id lives at top-level (stream/webhook reply) or under data
  // (sync submit reply) — accept either.
  const taskId =
    body?.id ||
    body?.data?.id ||
    body?.taskId ||
    body?.task_id ||
    null;
  if (!taskId) {
    return NextResponse.json({ ok: true, note: "No id in payload" });
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

  const event = String(body?.status || body?.event || "unknown");
  const nextMeta = {
    ...(hist.metadata || {}),
    webhook_received_at: new Date().toISOString(),
    webhook_event: event,
    webhook_provider: "p4",
  };
  await admin
    .from("history")
    .update({ metadata: nextMeta })
    .eq("id", hist.id);

  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
