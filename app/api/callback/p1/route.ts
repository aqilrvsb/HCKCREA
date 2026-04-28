import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p1?secret=<CALLBACK_SECRET>
// GeminiGen.AI webhook receiver.
//
// GeminiGen actually ships TWO different payload shapes depending on
// where you read their docs:
//   1. API-docs page (/getting-started/webhooks):
//      { event: "VIDEO_GENERATION_COMPLETED", uuid, data }
//   2. Service-Integration UI:
//      { event: "image.generated", timestamp, data: { id, status, url, user_id } }
// We accept both and pull the resource id from whichever field is set.
//
// Auth: query-secret gate — same pattern as /api/callback/p2. The route
// also re-verifies via GET /uapi/v1/history/{uuid} inside settleHistoryRow
// before flipping anything, so a spoofed body can't trick us.
//
// We always reply 200 (except on a failed secret check) so GeminiGen
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

  // Resource id can land in any of these fields depending on which
  // payload shape GeminiGen sent. We try them in order of specificity.
  const uuid =
    body?.uuid ||
    body?.data?.uuid ||
    body?.data?.id ||
    body?.id ||
    null;
  if (!uuid) {
    return NextResponse.json({ ok: true, note: "No uuid in payload" });
  }

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .select("*")
    .eq("task_id", String(uuid))
    .maybeSingle();

  if (!hist) {
    // Could be from a different deployment, or a job we never tracked.
    // Returning 200 prevents GeminiGen retrying forever (3 retries × 1h).
    return NextResponse.json({ ok: true, note: "No matching history row" });
  }

  // Stamp arrival metadata so /admin/webhook-log shows when GeminiGen
  // actually delivered the callback.
  const event = String(body?.event || "unknown");
  const nextMeta = {
    ...(hist.metadata || {}),
    webhook_received_at: new Date().toISOString(),
    webhook_event: event,
    webhook_provider: "p1",
  };
  await admin
    .from("history")
    .update({ metadata: nextMeta })
    .eq("id", hist.id);

  await settleHistoryRow(hist);
  return NextResponse.json({ ok: true });
}
