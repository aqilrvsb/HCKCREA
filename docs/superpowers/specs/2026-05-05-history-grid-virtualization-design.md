# History Grid — "Blazing Fast" Virtualization Design

**Date:** 2026-05-05
**Status:** Approved (Approach B)
**Author:** Brainstormed with admin@gmail.com on production peninglab.com

---

## Goal

Make every history surface in the dashboard feel like a native app, even when a client has 100+ videos per tab. Specifically:

| Metric | Target | Today |
|---|---|---|
| Cold tab-switch render-to-content | <800ms | 1,300–4,200ms |
| Warm re-tab (same data) | <100ms | 2,000ms |
| Status-flip re-render (during active gen) | <50ms | full grid re-renders |
| Scroll back through 100 videos | 60fps smooth | currently impossible (paginated) |
| Memory at 100 videos | <15MB | grows linearly per page visit |

Surfaces in scope: UGC tab · Auto Content tab · Cinema tab · Storytelling tab (videos + images sub-tabs) · Storage section.

## Non-goals (out of scope for this spec)

- RSC / Suspense streaming for the initial render (future iteration)
- Supabase Realtime push subscription (future iteration — polling stays at 15s)
- Service Worker caching of video posters across sessions (future iteration)
- Backend pagination indexes / materialized views (Supabase handles current scale)
- Rewriting the history-grid component contract — we wrap, never rewrite

## Real-world baseline (measured 2026-05-05 on prod)

Captured via Playwright instrumentation as admin@gmail.com inside EXCLUSIVE project:

| Tab | Render TTI | Video els | DOM nodes | Network calls | Total network |
|---|---|---|---|---|---|
| Image | 1ms | 0 | 476 | 0 | 0ms |
| UGC | 16ms | 36 | 770 | 2 | 1,296ms |
| Auto Content | 26ms | 10 | 773 | 3 | 2,601ms |
| Cinema | 12ms | 2 | 208 | 5 | 4,156ms |
| Storytelling | 25ms | 1 | 300 | 3 | 2,045ms |
| Page-2 nav | — | — | — | 0 | 1,502ms (pure render) |
| Re-tab UGC (warm) | — | — | — | 2 | 2,007ms (re-fetch) |

### The 4 verified bottlenecks

1. `/api/storage/status` blocks ~900ms on every tab switch (universal).
2. UGC pages produce 36 `<video>` elements (12 cards × 3 thumbs) — current 2-concurrent poster bucket takes ~18s to fill them all.
3. No client-side data cache — re-tab re-fetches the same Supabase query.
4. Page-2 navigation: 0 network calls but 1.5s render churn — React reconciles 12 fresh card subtrees + 36 IntersectionObservers + LazyVideo bucket queue.

## Architecture — Four additive layers

Each layer is a single git commit, independently revertible. Order matters: ship each, verify on production, then ship the next.

### Layer 1 — `React.memo` on `HistoryCard`

Wrap `HistoryCard` (currently at `app/dashboard/sections/history-grid.tsx:537`) with a custom equality check:

```ts
export default React.memo(HistoryCard, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.status === next.item.status &&
    prev.item.output_url === next.item.output_url &&
    prev.item.merged_url === next.item.merged_url &&
    prev.seg2?.id === next.seg2?.id &&
    prev.seg2?.status === next.seg2?.status &&
    prev.saveStatus?.saved === next.saveStatus?.saved &&
    prev.mergeSelectedIdx === next.mergeSelectedIdx
  );
});
```

**Effect:** when polling fires and one row flips status, the other 11 cards no-op instead of re-rendering. Status-flip cost drops from ~150ms (12 cards) to <30ms (1 card).

### Layer 2 — SWR data cache

Add `swr` (~5KB gzipped) and wrap the existing `load()` fetcher:

```ts
import useSWR from "swr";

const cacheKey = `history:${tab}:${projectId}:${sortDir}:${storytellingSubTab}`;
const { data: items, mutate } = useSWR(cacheKey, fetchHistoryRows, {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
});
```

The polling effect calls `mutate()` instead of doing its own fetch. Re-tab to the same surface returns from memory.

`/api/storage/status` gets a parallel SWR wrapper keyed by `storage:status:<sorted-ids-hash>` — avoids the 900ms block on every tab switch.

**Effect:** warm re-tab drops from 2,007ms → ~30ms. Status fetch on tab switch eliminated when cached.

### Layer 3 — Virtualized infinite scroll with `@tanstack/react-virtual`

Replace the paginated `pageItems.slice(safePage * PAGE_SIZE, …)` model with a virtualizer:

```ts
import { useVirtualizer } from "@tanstack/react-virtual";

const parentRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: visibleParents.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 320, // approx card height
  overscan: 4, // render 4 cards above/below viewport for smooth scroll
});
```

Render only `virtualizer.getVirtualItems()`. As the user scrolls toward the end, fetch the next 20 rows via Supabase `.range(offset, offset + 19)` and append to `items`. Old cards (now off-screen) get unmounted by the virtualizer — DOM stays at ~8-12 cards regardless of total list length.

**Pagination controls (Prev / 1 / 2 / Next) are removed** — replaced by infinite scroll. The grid scroll container is its own scroll axis nested inside the page.

**Initial fetch reduces from 60 rows → 20 rows.** Subsequent batches of 20 load on scroll.

**Effect:**
- DOM nodes: ~770 → ~150 (regardless of 12 or 100 videos)
- Memory at 100 videos: stays flat ~10MB
- Scroll-back through 100 items: 60fps smooth
- Page-2 nav (eliminated entirely): 0ms

### Layer 4 — Skeleton placeholders during cold load

While SWR fetches the first batch (no cached data), render 8 skeleton cards using the existing card layout dims with a `bg-muted animate-pulse` overlay. Replaces the current "blank → pop" UX.

**Effect:** perceived speed dramatically better. Real cold-start TTI doesn't change but the screen never feels empty.

## Component-by-component impact

| File | Change | Risk |
|---|---|---|
| `app/dashboard/sections/history-grid.tsx` | Wrap card export in `React.memo`; swap `pageItems.map()` for `virtualizer.getVirtualItems().map()`; remove pagination controls; useSWR for items + saveStatus; skeleton render branch | Medium — biggest file change |
| `app/dashboard/sections/storage.tsx` | Apply same SWR + virtualizer pattern to its own grid | Low — same shape |
| `app/components/lazy-video.tsx` | No change — works as-is inside virtualized rows (IntersectionObserver fires correctly when virtual rows mount) | None |
| `app/dashboard/tabs/*.tsx` | No change — they pass `tab` + `projectId` to history-grid as before | None |
| `app/api/storage/status/route.ts` | No change — SWR caches the response | None |
| `package.json` | Add `swr` (~5KB) + `@tanstack/react-virtual` (~5KB) | None |

Total new dep weight: ~10KB gzipped.

## Data flow (post-implementation)

```
Initial page load
   ↓
useSWR("history:ugc:proj1") → cache miss → fetch first 20 rows
   ↓
While loading: skeleton cards render
   ↓
Data lands → virtualizer mounts ~8 visible cards
   ↓
Each card runs LazyVideo poster fetch (existing 2-concurrent bucket)
   ↓
User scrolls down toward end of list
   ↓
useSWR re-fetches next 20 rows via Supabase .range() and appends
   ↓
Virtualizer mounts the next ~8 cards as user scrolls into them
   ↓
Cards above viewport unmount (DOM stays small)

Status poll fires every 15s (existing logic)
   ↓
mutate() updates SWR cache
   ↓
React.memo lets unchanged cards skip render
   ↓
Only the card whose status changed re-paints

User clicks back to a previous tab
   ↓
useSWR cache hit → ~30ms render from memory
   ↓
Stale-while-revalidate fires a background refresh if data is >5s old
```

## Error handling

- SWR retry: 3 attempts on network error with exponential backoff (built-in)
- Virtualizer height mismatch: `estimateSize()` is a hint; on mount the virtualizer measures real heights and adjusts. No manual handling needed.
- Empty state: when SWR returns empty array, render the existing "No history yet" placeholder (already in code at history-grid.tsx).
- Failed scroll-load: SWR's `error` field surfaces — show a small "Couldn't load more" banner with retry button at the list bottom.
- Old saved-pagination URL params (`?page=3`): we ignore them post-migration (no harm — virtualized scroll just renders from top).

## Testing approach

### Manual MCP verification (production)

After each layer ships, run the same Playwright instrumentation that captured the baseline:

```js
async function measureTab(tabRegex, label) { … }
```

Compare TTI, network calls, DOM nodes against baseline. Each layer should improve at least one metric.

### Visual regression

For each tab (UGC / Auto / Cinema / Storytelling / Storage):
1. Cold tab-switch — verify cards render
2. Scroll through 30+ rows — verify virtualization mounts/unmounts correctly
3. Click an action button (Save / Delete / Extend) — verify it still wires up
4. Switch tabs and back — verify SWR cache hit (no spinner)
5. Trigger a generation, watch a card flip pending → done — verify React.memo skipped other cards (confirm via React DevTools Profiler)

### Type-check + build gates

`npx tsc --noEmit --skipLibCheck` clean. `next build` succeeds.

## Migration plan (4 commits, independently revertible)

1. **Commit 1: React.memo on HistoryCard** (~10 min, near-zero risk)
2. **Commit 2: Add SWR for items + saveStatus** (~45 min, low risk — wraps existing fetch)
3. **Commit 3: Virtualized infinite scroll, remove pagination controls** (~90 min, medium risk — biggest change)
4. **Commit 4: Skeleton cards during cold load** (~30 min, low risk — additive UI)

Each commit shipped to production individually. After each, re-run the baseline measurement script via MCP and confirm we're moving toward (not away from) the targets. If any commit regresses, revert just that commit and the prior ones stay live.

## Acceptance criteria

The implementation is complete when, measured via MCP on production:

- [ ] Cold UGC tab-switch render-to-content: <800ms
- [ ] Warm re-tab (back to UGC after a side trip): <100ms
- [ ] Status-flip re-render during active generation: <50ms (verified via React DevTools Profiler)
- [ ] Scroll through 100-video list: visual 60fps, no DOM growing past ~200 nodes
- [ ] Same metrics achieved on Auto Content, Cinema, Storytelling, Storage
- [ ] Existing actions (Save, Delete, Extend, Combine, Improve) all still work end-to-end
- [ ] Type-check + Next build clean

---

## Self-review notes

- **No placeholders/TBD:** every section concrete.
- **Internal consistency:** Layer 1 (memo) only helps if Layer 2 (SWR) actually changes the data reference predictably — confirmed: SWR returns the same array reference when data is unchanged, so memo's `item.id === item.id` check holds.
- **Scope check:** focused on history grid + storage. Sidebar, modals, tabs, generation routes are explicitly untouched.
- **Ambiguity:** "scroll through 100 videos" — defined as scrolling from row 0 to row 100 in <2s with no jank. Memory bar set to <15MB so it's measurable.
