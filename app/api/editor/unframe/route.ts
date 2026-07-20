import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/editor/unframe  { history_ids: string[], to_tab?: boolean }  (framed row ids)
//
// Removes the framed (intro+video) row and restores the ORIGINAL video:
//   • to_tab=false (default, "Undo Frame") → original back in the Editor
//     (in_editor=true), Text/Cover intact, ready to re-frame.
//   • to_tab=true   ("Delete" on a framed card) → original back to its
//     ORIGINAL tab (in_editor=false) — NOT hard-deleted, so the paid video is
//     never lost; it just leaves the Editor like a normal "Buang dari Editor".
// Owner only, session-authed.
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
  // to_tab=true → original leaves the Editor (back to its tab) instead of staying.
  const toTab = body?.to_tab === true;

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

    // Restore the original: un-hide + put it back in the Editor. IMPORTANT —
    // the original's Text + Cover are KEPT (cover_thumbnail_url, cover_title,
    // cover_subtitle stay in metadata; caption is its own column and is never
    // touched here). We only strip the two frame-bookkeeping flags, so Undo
    // Frame never makes the user re-generate Text/Cover — only the Frame itself
    // needs redoing.
    const { data: orig } = await admin.from("history").select("metadata").eq("id", originalId).eq("user_id", user.id).maybeSingle();
    if (orig) {
      const om = (orig.metadata || {}) as Record<string, any>;
      delete om.hidden_by_frame;
      delete om.framed_child;
      // Explicitly carry Text/Cover forward (defensive — they're already in om).
      // in_editor: false (to_tab) → back to original tab; true → stays in Editor.
      await admin.from("history").update({
        metadata: {
          ...om,
          in_editor: !toTab,
          cover_thumbnail_url: om.cover_thumbnail_url ?? null,
          cover_title: om.cover_title ?? null,
          cover_subtitle: om.cover_subtitle ?? null,
        },
      }).eq("id", originalId).eq("user_id", user.id);
    }
    // Remove the framed row entirely (it's a derived artifact).
    await admin.from("history").delete().eq("id", framed.id).eq("user_id", user.id);
    undone++;
  }

  return NextResponse.json({ ok: true, undone });
}
