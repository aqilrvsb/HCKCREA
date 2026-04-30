import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/dismiss { history_id, dismissed: true|false }
//
// Toggles dismissed_from_extension on a history row. When TRUE the row
// stops appearing in /api/extension/recent — the user has chosen to
// archive it from the extension's view without deleting it from
// history. Useful for cleaning up videos the user doesn't want to
// post (e.g. failed audio, off-brand persona) without losing the
// record entirely.
//
// Auth: extension's three-mode authExtensionUser. Owner check explicit
// since admin client bypasses RLS.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const dismissed = body?.dismissed !== false; // default true
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
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
    .update({ dismissed_from_extension: dismissed })
    .eq("id", historyId);

  return NextResponse.json({ ok: true, dismissed });
}
