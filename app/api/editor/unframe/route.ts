import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/editor/unframe  { history_ids: string[] }  (framed row ids)
//
// Undo Frame — removes the framed (intro+video) row and brings the ORIGINAL
// video back into the Editor. Owner only, session-authed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : body?.history_id ? [String(body.history_id).trim()] : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: framedRows } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .in("id", ids)
    .eq("user_id", user.id);

  let undone = 0;
  for (const framed of framedRows || []) {
    const meta = (framed.metadata || {}) as Record<string, any>;
    const originalId = String(meta.framed_from || "").trim();
    if (!originalId) continue; // not a framed row — skip

    // Restore the original: un-hide + put it back in the Editor.
    const { data: orig } = await admin.from("history").select("metadata").eq("id", originalId).eq("user_id", user.id).maybeSingle();
    if (orig) {
      const om = (orig.metadata || {}) as Record<string, any>;
      delete om.hidden_by_frame;
      delete om.framed_child;
      await admin.from("history").update({ metadata: { ...om, in_editor: true } }).eq("id", originalId).eq("user_id", user.id);
    }
    // Remove the framed row entirely (it's a derived artifact).
    await admin.from("history").delete().eq("id", framed.id).eq("user_id", user.id);
    undone++;
  }

  return NextResponse.json({ ok: true, undone });
}
