import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/mark-posted { history_id, posted: true|false }
//
// Flips the posted_to_tiktok flag on a history row after the extension
// finishes its auto-post flow. Pure UI bookkeeping for the extension —
// doesn't affect generation, billing, or any downstream pipeline.
//
// Auth: must own the row. The extension passes its session cookie so
// auth.getUser() resolves the same user the row belongs to.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const posted = body?.posted !== false; // default true
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Ownership check — silently no-op if the row isn't this user's.
  const { data: row } = await admin
    .from("history")
    .select("id, user_id")
    .eq("id", historyId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await admin
    .from("history")
    .update({
      posted_to_tiktok: posted,
      posted_at: posted ? new Date().toISOString() : null,
    })
    .eq("id", historyId);

  return NextResponse.json({ ok: true, posted });
}
