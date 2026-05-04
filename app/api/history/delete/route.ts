import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// DELETE /api/history/delete?id=<history_id>
//
// Two flavours of delete:
//
// 1. PLAIN ROW (no segment_index, or segment_index=1 with no children):
//    Deletes just the row. RLS-bound user-scoped client.
//
// 2. SEGMENT ROW (has parent_history_id — it's an extend child):
//    Cascade-deletes:
//      • this seg-N row
//      • any later siblings (seg-N+1, seg-N+2, …) — same parent_history_id,
//        created_at > this row's
//      • reverts the chain-root parent: output_url ← metadata.seg1_url,
//        clears merged_at / seg2_url / merged_url so the parent reverts
//        to a plain 8s clip the user can re-extend.
//
// 3. CHAIN ROOT (segment_index=1 OR no parent and HAS children):
//    Cascade-deletes the root + every child where parent_history_id = root.id.
//
// Service-role admin client is used for the cascade reads / parent
// rollback because the parent might be touched by other table policies;
// we still gate on user_id match for safety.
export async function DELETE(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();

  // Fetch the target row first so we know whether to cascade.
  const { data: target, error: fetchErr } = await admin
    .from("history")
    .select("id, user_id, parent_history_id, segment_index, created_at, metadata")
    .eq("id", id)
    .single();
  if (fetchErr || !target) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }
  if (target.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Case 2 — child segment row. Cascade later siblings + roll parent back.
  if (target.parent_history_id) {
    // Find later siblings (rows with same parent_history_id, created later).
    const { data: laterSiblings } = await admin
      .from("history")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("parent_history_id", target.parent_history_id)
      .gt("created_at", target.created_at);
    const idsToDelete = [
      target.id,
      ...((laterSiblings || []).map((r: any) => r.id) as string[]),
    ];

    // Roll parent back: re-fetch its metadata first so we don't clobber
    // unrelated keys. Then revert output_url to seg1_url and clear the
    // merge / seg-2 fields.
    const { data: parent } = await admin
      .from("history")
      .select("id, metadata")
      .eq("id", target.parent_history_id)
      .eq("user_id", user.id)
      .single();
    if (parent) {
      const meta = (parent.metadata as Record<string, any>) || {};
      const seg1Url: string | undefined = meta.seg1_url;
      const cleanedMeta = { ...meta };
      delete cleanedMeta.seg2_url;
      delete cleanedMeta.merged_at;
      delete cleanedMeta.seg1_url; // no longer needed once we collapse back
      const update: Record<string, any> = {
        merged_url: null,
        metadata: cleanedMeta,
      };
      if (seg1Url) update.output_url = seg1Url;
      await admin.from("history").update(update).eq("id", parent.id);
    }

    const { error: delErr } = await admin
      .from("history")
      .delete()
      .in("id", idsToDelete)
      .eq("user_id", user.id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      deleted_segment: target.id,
      cascaded_siblings: idsToDelete.length - 1,
      parent_reverted: !!parent,
    });
  }

  // Case 3 — chain root. Delete root + all children.
  const { data: children } = await admin
    .from("history")
    .select("id")
    .eq("user_id", user.id)
    .eq("parent_history_id", target.id);
  const childIds = (children || []).map((r: any) => r.id);
  if (childIds.length > 0) {
    await admin.from("history").delete().in("id", childIds).eq("user_id", user.id);
  }

  // Case 1 (and root) — final delete of the target itself.
  const { error } = await admin
    .from("history")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    deleted_root: id,
    cascaded_children: childIds.length,
  });
}
