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
    // Idempotent delete — if the row is already gone, that's the desired
    // end state. Return ok so the client clears the card without an
    // alert + retry loop. Useful when the user spam-clicks delete or
    // when a previous delete partially succeeded.
    return NextResponse.json({ ok: true, deleted: 0, note: "Row already gone" });
  }
  if (target.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Case 2 — child segment row. Delete ONLY this segment + roll the
  // parent back to its previous state. Earlier-iteration cascade-deleted
  // any later siblings too, but the user wants independent deletes:
  // removing seg-2 should leave seg-3 alone (and vice versa).
  if (target.parent_history_id) {
    // Roll parent back to a clean seg-1-only state. Three cases to
    // handle based on where in the 16s chain the parent currently sits:
    //
    //   (A) Already merged — parent.merged_url is set AND
    //       metadata.seg1_url is preserved. Roll output_url back to
    //       seg1_url, clear merged_url + the merge metadata.
    //   (B) Merged but no seg1_url (legacy / partial data). merged_url
    //       points at a now-dead .mp4. Clear output_url + merged_url
    //       both so LazyVideo doesn't CORS-loop on the dead URL.
    //   (C) Not yet merged — parent.merged_url is NULL and output_url
    //       still holds the seg-1 video URL (set when seg-1 settled).
    //       Leave output_url alone; just drop seg-2 metadata if present.
    const { data: parent } = await admin
      .from("history")
      .select("id, output_url, merged_url, metadata")
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
        metadata: cleanedMeta,
      };
      if (parent.merged_url) {
        // Cases A + B — merge happened, so output_url currently points
        // at the merged.mp4 which is about to become stale.
        update.merged_url = null;
        update.output_url = seg1Url || null;
      }
      // Case C (not merged) — touch neither output_url nor merged_url.
      await admin.from("history").update(update).eq("id", parent.id);
    }

    const { error: delErr } = await admin
      .from("history")
      .delete()
      .eq("id", target.id)
      .eq("user_id", user.id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      deleted_segment: target.id,
      cascaded_siblings: 0,
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
