import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/editor/undo-post  { history_ids: string[] }  (or { history_id })
//
// Reverses the extension's auto-post for the given videos: clears
// posted_to_tiktok / posted_at AND flags metadata.in_editor=true so each video
// leaves the Done Post grid and reappears in the Editor. Owner only,
// session-authed (web dashboard). jsonb metadata is merged per-row so nothing
// else on it is lost.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : body?.history_id
      ? [String(body.history_id).trim()]
      : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });

  const admin = createAdminClient();
  // Only this user's rows — ownership enforced by the user_id filter.
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .in("id", ids)
    .eq("user_id", user.id);

  const owned = rows || [];
  let undone = 0;
  for (const row of owned) {
    const meta = (row.metadata || {}) as Record<string, any>;
    const { error } = await admin
      .from("history")
      .update({
        posted_to_tiktok: false,
        posted_at: null,
        metadata: { ...meta, in_editor: true },
      })
      .eq("id", row.id)
      .eq("user_id", user.id);
    if (!error) undone++;
  }

  return NextResponse.json({ ok: true, undone });
}
