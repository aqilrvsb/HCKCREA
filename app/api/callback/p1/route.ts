import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/callback/p1?secret=<CALLBACK_SECRET>
// GeminiGen.AI webhook receiver.
//
// Per https://docs.geminigen.ai/getting-started/webhooks the payload is:
//   { event, uuid, data }
// Events:
//   VIDEO_GENERATION_COMPLETED / VIDEO_GENERATION_FAILED
//   IMAGE_GENERATION_COMPLETED / IMAGE_GENERATION_FAILED
//
// Auth: same query-secret pattern as /api/callback/p2 — only payloads
// originating from URLs we generated for our own jobs settle anything.
// (GeminiGen also signs the body via x-signature with a public key for
// HMAC-SHA256 verification; we treat the secret query param as the
// primary gate and leave the optional public-key verify as a TODO.)
//
// We don't trust the webhook body to flip the row directly — we resolve
// by uuid → look up the history row → call settleHistoryRow which
// re-verifies via /uapi/v1/history/{uuid} and is idempotent.
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

  // GeminiGen identifies the resource by uuid at the top level.
  const uuid = body?.uuid || body?.data?.uuid || body?.id || null;
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
