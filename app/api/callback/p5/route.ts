import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p5?secret=<CALLBACK_SECRET>
//
// APIMart webhook receiver. We poll /v1/tasks/{id} by default; this
// endpoint is for the future case where APIMart adds push callbacks.
// Re-verifies via settleHistoryRow → p5GetStatus before flipping
// anything, so a spoofed body can't trick us.

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
    body?.task_id ||
    body?.taskId ||
    body?.data?.task_id ||
    body?.data?.[0]?.task_id ||
    body?.id ||
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
    return NextResponse.json({ ok: true, note: "No matching history row" });
  }

  const event = String(body?.status || body?.event || "unknown");
  const nextMeta = {
    ...(hist.metadata || {}),
    webhook_received_at: new Date().toISOString(),
    webhook_event: event,
    webhook_provider: "p5",
  };
  await admin
    .from("history")
    .update({ metadata: nextMeta })
    .eq("id", hist.id);

  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
