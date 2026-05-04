// Hide rule for history rows whose 14-day P1/P2 TTL is up AND that
// were never saved to permanent Storage. Used by:
//   - app/dashboard/sections/history-grid.tsx (the main grid)
//   - app/dashboard/tabs/*.tsx HistoryPicker components (the From-History
//     pickers in image / video / cinema / auto-content / clone)
//
// Both surfaces apply the same rule so a row that disappears from
// the grid also disappears from the picker — no way to accidentally
// re-use a dead URL.
//
// Usage:
//   const ids = items.map(i => i.id);
//   const saved = await fetchSavedSet(ids);
//   const visible = items.filter(i => isVisibleAfterTtl(i.created_at, saved.has(i.id)));

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Storytelling rows hide EARLIER than the standard 14-day TTL — once
// they hit ≤1 day to expiry, an unsaved storytelling row vanishes
// from the history grid. The save countdown chip on the card is the
// warning; this filter is what enforces it.
const STORYTELLING_EARLY_CUTOFF_MS = 13 * 24 * 60 * 60 * 1000;

export function isVisibleAfterTtl(
  createdAtIso: string | null | undefined,
  saved: boolean
): boolean {
  if (!createdAtIso) return true; // unknown age — keep visible
  const ageMs = Date.now() - new Date(createdAtIso).getTime();
  if (ageMs < TTL_MS) return true; // not expired yet
  return saved; // expired — only keep if saved to Storage
}

// Storytelling-specific filter: hides unsaved fairytale + fairytale-scene
// rows once their remaining TTL drops to ≤1 day. The user's flow is
// "save what you want to keep, the rest auto-cleans up so the grid
// doesn't bloat with abandoned generations".
export function isStorytellingVisible(
  createdAtIso: string | null | undefined,
  saved: boolean
): boolean {
  if (!createdAtIso) return true; // unknown age — keep visible
  if (saved) return true; // saved rows always visible
  const ageMs = Date.now() - new Date(createdAtIso).getTime();
  return ageMs < STORYTELLING_EARLY_CUTOFF_MS;
}

// Batched lookup of which history IDs have a corresponding row in
// the storage table (= saved to permanent B2). Returns a Set for O(1)
// lookups in the filter loop.
export async function fetchSavedSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const r = await fetch("/api/storage/status", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history_ids: ids }),
    });
    if (!r.ok) return new Set();
    const d = await r.json();
    const out = new Set<string>();
    const statuses = d?.statuses || {};
    for (const [id, s] of Object.entries<any>(statuses)) {
      if (s?.saved) out.add(id);
    }
    return out;
  } catch {
    return new Set();
  }
}
