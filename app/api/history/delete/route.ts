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
  // Owner can delete their own rows. Admins can delete anyone's row
  // (used by /admin/errors bulk delete).
  let ownerId = user.id;
  if (target.user_id !== user.id) {
    const { data: me } = await sb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!me?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    ownerId = target.user_id;
  }

  // Case 2 — child segment row. Delete this segment + cascade to any
  // LATER siblings (seg-3, seg-4, …) so the chain stays consistent.
  // Per-user intent: deleting seg-2 should never leave seg-1 stuck on
  // the merged 16s URL, and should never leave an orphan seg-3 child
  // pointing back at a parent that no longer has seg-2 to merge into.
  // Earlier sibling rows (e.g. seg-1 itself) are NEVER touched — only
  // the deleted row and anything chronologically AFTER it.
  if (target.parent_history_id) {
    // 2a. Find all later siblings of this segment (same parent, created
    //     after the target). These are the seg-3 / seg-4 / … rows that
    //     depended on this seg being present. Delete them all in one
    //     pass so we don't leave dangling children.
    const { data: laterSiblings } = await admin
      .from("history")
      .select("id, created_at")
      .eq("user_id", ownerId)
      .eq("parent_history_id", target.parent_history_id)
      .neq("id", target.id)
      .gt("created_at", target.created_at);
    const laterIds = (laterSiblings || []).map((r: any) => r.id);

    // 2b. Roll parent back to its clean pre-extend state. Three cases:
    //
    //   (A) Already merged — parent.merged_url is set AND
    //       metadata.seg1_url is preserved by mergeSegments. Roll
    //       output_url back to seg1_url, clear merged_url + merge meta.
    //   (B) Merged but no seg1_url (legacy data). Best effort: clear
    //       merged_url; if we can find the seg-1 url anywhere
    //       (parent's reference_url for older rows), use it; else null.
    //   (C) Not yet merged — parent.merged_url is NULL and output_url
    //       still holds the seg-1 video URL (set when seg-1 settled).
    //       Leave output_url alone; just drop seg-2 metadata.
    const { data: parent } = await admin
      .from("history")
      .select("id, output_url, merged_url, metadata, reference_url")
      .eq("id", target.parent_history_id)
      .eq("user_id", ownerId)
      .single();
    if (parent) {
      const meta = (parent.metadata as Record<string, any>) || {};
      const seg1Url: string | undefined = meta.seg1_url;
      const cleanedMeta = { ...meta };
      delete cleanedMeta.seg2_url;
      delete cleanedMeta.merged_at;
      delete cleanedMeta.seg1_url; // no longer needed once we collapse back
      // Also clear chain-phase markers so the placeholder doesn't
      // show "refining with banana…" on a row that just lost its
      // seg-2 trigger.
      delete cleanedMeta.chain_phase;
      delete cleanedMeta.chain_phase_at;
      const update: Record<string, any> = {
        metadata: cleanedMeta,
      };
      if (parent.merged_url) {
        // Cases A + B — merge happened, output_url is the merged.mp4.
        // Always strip merged_url; restore seg1Url if we have it, else
        // null (Case B). The card UI handles null output_url with a
        // "video expired" badge instead of CORS-looping on dead URL.
        update.merged_url = null;
        update.output_url = seg1Url || null;
      }
      // Case C (not merged) — touch neither output_url nor merged_url.
      await admin.from("history").update(update).eq("id", parent.id);
    }

    // 2c. Delete the target row + all later siblings in one batch.
    const idsToDelete = [target.id, ...laterIds];
    const { error: delErr } = await admin
      .from("history")
      .delete()
      .in("id", idsToDelete)
      .eq("user_id", ownerId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      deleted_segment: target.id,
      cascaded_siblings: laterIds.length,
      cascaded_ids: laterIds,
      parent_reverted: !!parent,
    });
  }

  // Case 3 — chain root. Per-user intent: deleting seg-1 should ONLY
  // delete seg-1, leaving any seg-2 / seg-3 / … as INDEPENDENT cards
  // (the user still wants those clips, they just don't want the seg-1
  // origin anymore). Promote each child to a standalone row by
  // clearing parent_history_id + segment_index + frame_anchor + chain
  // metadata so the dashboard renders them as their own cards instead
  // of orphan children pointing to a deleted parent.
  const { data: children } = await admin
    .from("history")
    .select("id, metadata")
    .eq("user_id", ownerId)
    .eq("parent_history_id", target.id);
  const childIds = (children || []).map((r: any) => r.id);
  if (childIds.length > 0) {
    // Strip chain-related fields from each child so they render as
    // standalone clips. Per-row update so we can clean each child's
    // own metadata blob (parent_id / segment_role / chain_phase get
    // stale once detached from the chain).
    await Promise.all(
      (children || []).map(async (c: any) => {
        const m = (c.metadata as Record<string, any>) || {};
        const cleaned = { ...m };
        delete cleaned.segment_role;
        delete cleaned.parent_id;
        delete cleaned.chain_phase;
        delete cleaned.chain_phase_at;
        delete cleaned.seg1_url;
        delete cleaned.seg2_url;
        delete cleaned.merged_at;
        await admin
          .from("history")
          .update({
            parent_history_id: null,
            segment_index: null,
            frame_anchor: null,
            metadata: cleaned,
          })
          .eq("id", c.id)
          .eq("user_id", ownerId);
      })
    );
  }

  // Case 1 (and root) — final delete of the target itself.
  const { error } = await admin
    .from("history")
    .delete()
    .eq("id", id)
    .eq("user_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    deleted_root: id,
    promoted_children: childIds.length,
    promoted_ids: childIds,
  });
}
