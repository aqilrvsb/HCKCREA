import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p6?secret=<CALLBACK_SECRET>
//
// APIPod webhook receiver. APIPod's submit body accepts callback_url,
// so admin can flip from polling to push by stamping this endpoint
// (with the CRON_SECRET query param) on every p6CreateVideo /
// p6CreateImage call. We default to polling; the webhook just
// re-verifies via settleHistoryRow when an upstream push arrives.

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
    webhook_provider: "p6",
  };
  await admin.from("history").update({ metadata: nextMeta }).eq("id", hist.id);
  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
