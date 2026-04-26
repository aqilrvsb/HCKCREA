import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/webhook-log
// Returns the last 30 history rows that received a Crun.ai webhook hit
// (metadata.webhook_received_at is set). Useful to confirm the webhook
// is actually firing in production. Admin-only.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pull the most recent rows where the webhook stamped metadata.
  const { data: rows } = await admin
    .from("history")
    .select("id, type, tab, status, task_id, output_url, error_message, metadata, created_at, updated_at")
    .not("metadata->>webhook_received_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(30);

  // Also pull pending rows so admin can see what hasn't fired yet.
  const { data: stillPending } = await admin
    .from("history")
    .select("id, type, status, task_id, created_at")
    .eq("status", "pending")
    .not("task_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const summary = {
    total_with_webhook: rows?.length || 0,
    pending_no_webhook_yet: stillPending?.length || 0,
    most_recent_webhook_at: rows?.[0]?.metadata?.webhook_received_at || null,
  };

  return NextResponse.json({
    ok: true,
    summary,
    recent_webhooks: (rows || []).map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      task_id: r.task_id,
      webhook_received_at: r.metadata?.webhook_received_at || null,
      webhook_status: r.metadata?.webhook_status || null,
      output_url: r.output_url ? r.output_url.substring(0, 80) + "…" : null,
      error: r.error_message,
      created_at: r.created_at,
    })),
    pending_awaiting_webhook: stillPending,
  });
}
