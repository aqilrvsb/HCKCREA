// Server-side mirror of the client's history visibility rules.
//
// Used by surfaces that act on history rows ON BEHALF OF the user
// (admin tools, cron workers) so they only touch rows the user can
// still see in their own dashboard. Three cases the filter catches:
//
//   1. Hard-deleted rows are already gone from `history` — the SELECT
//      that produces the input list will already miss them.
//   2. TTL-expired rows: ≥14 days old AND not saved to permanent
//      storage. Present in `history` but hidden by the grid.
//   3. ORPHAN rows: `project_id IS NULL` or `project_id` points to a
//      deleted project. Deleting a project nulls the column instead
//      of cascade-deleting the rows (so a future "unscoped history"
//      could surface them) — but today's dashboard always scopes by
//      project_id, so these rows are invisible to the client. Cron
//      shouldn't resubmit them either.
//
// Two DB round-trips: one to `storage` to build the saved-id set,
// one to `projects` to build the live-project-id set. Storage call
// is skipped when no row in the batch is past the TTL.

import { createAdminClient } from "@/lib/supabase/admin";

const TTL_MS = 14 * 24 * 60 * 60 * 1000;

type WithVisibilityFields = {
  id: string;
  user_id: string;
  created_at: string;
  project_id?: string | null;
};

export async function filterVisibleToClient<T extends WithVisibilityFields>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return [];

  const now = Date.now();
  const admin = createAdminClient();

  // 1. Build the live-project set per user. Anything whose project_id
  //    is null OR not in this set is orphaned — drop it.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: projectRows } = await admin
    .from("projects")
    .select("id, user_id")
    .in("user_id", userIds);
  const liveProjectIds = new Set<string>();
  for (const p of projectRows || []) {
    if (p.id) liveProjectIds.add(p.id);
  }

  // 2. Build the saved-id set, but only if any row is past the TTL.
  //    Cron's 24h window almost always skips this.
  let savedSet: Set<string> = new Set();
  const anyExpired = rows.some(
    (r) => now - new Date(r.created_at).getTime() >= TTL_MS
  );
  if (anyExpired) {
    const ids = rows.map((r) => r.id);
    const { data: storageRows } = await admin
      .from("storage")
      .select("history_id, user_id")
      .in("history_id", ids)
      .in("user_id", userIds);
    for (const s of storageRows || []) {
      if (s.history_id) savedSet.add(s.history_id);
    }
  }

  return rows.filter((r) => {
    // Orphan check: row must belong to a live project the user owns.
    if (!r.project_id || !liveProjectIds.has(r.project_id)) return false;

    // TTL check: <14d always visible, ≥14d only if saved to storage.
    const ageMs = now - new Date(r.created_at).getTime();
    if (ageMs < TTL_MS) return true;
    return savedSet.has(r.id);
  });
}
