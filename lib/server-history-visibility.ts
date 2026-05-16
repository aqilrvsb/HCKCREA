// Server-side mirror of lib/history-filter.ts → isVisibleAfterTtl.
//
// Used by surfaces that act on history rows BEHALF OF the user
// (admin tools, cron workers) to guarantee they only touch rows the
// user can still see in their own dashboard. Two cases the filter
// catches:
//
//   1. Hard-deleted rows are already gone from `history` — the SELECT
//      that produces the input list will already miss them.
//   2. TTL-expired rows: ≥14 days old AND not saved to permanent
//      storage. Still present in `history` but invisible to the
//      client. Filter drops them so cron doesn't resubmit a row the
//      user has effectively abandoned, and admin tools don't show
//      ghost entries.
//
// One DB round-trip — uses an `in()` lookup against the `storage`
// table to build the saved-id set, same shape as the client-side
// fetchSavedSet() helper.

import { createAdminClient } from "@/lib/supabase/admin";

const TTL_MS = 14 * 24 * 60 * 60 * 1000;

type WithVisibilityFields = {
  id: string;
  user_id: string;
  created_at: string;
};

export async function filterVisibleToClient<T extends WithVisibilityFields>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return [];

  // Fast path: if every row is younger than the TTL, the storage
  // lookup is unnecessary. Most cron batches (24h window) fall here.
  const now = Date.now();
  const anyExpired = rows.some(
    (r) => now - new Date(r.created_at).getTime() >= TTL_MS
  );
  if (!anyExpired) return rows;

  const admin = createAdminClient();
  const ids = rows.map((r) => r.id);
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: storageRows } = await admin
    .from("storage")
    .select("history_id, user_id")
    .in("history_id", ids)
    .in("user_id", userIds);

  const savedSet = new Set<string>();
  for (const s of storageRows || []) {
    if (s.history_id) savedSet.add(s.history_id);
  }

  return rows.filter((r) => {
    const ageMs = now - new Date(r.created_at).getTime();
    if (ageMs < TTL_MS) return true;
    return savedSet.has(r.id);
  });
}
