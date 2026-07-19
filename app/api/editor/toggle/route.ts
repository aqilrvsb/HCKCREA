import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/editor/toggle  { history_id, in_editor }
//
// Flag/unflag a video for the Editor. Persisted in history.metadata.in_editor
// so it survives refresh/navigation and shows up in the /editor page. Owner
// only. Session-authed (web dashboard).
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const inEditor = body?.in_editor !== false; // default true
  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .eq("id", historyId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const meta = (row.metadata || {}) as Record<string, any>;
  await admin
    .from("history")
    .update({ metadata: { ...meta, in_editor: inEditor } })
    .eq("id", historyId);

  return NextResponse.json({ ok: true, in_editor: inEditor });
}
