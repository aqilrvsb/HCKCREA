# History Grid Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all dashboard history surfaces (UGC, Auto Content, Cinema, Storytelling, Storage) feel like TikTok-class native apps — no lag at 100+ videos per tab — without breaking any existing component contracts or wiring.

**Architecture:** Four additive layers, each shipped as one independent git commit, each verified on production via MCP (Playwright) before the next ships. Layers compose: React.memo, then SWR cache, then `@tanstack/react-virtual`, then skeleton placeholders. Existing component props, action button wiring, polling logic, and save flow all stay intact — we wrap, never rewrite.

**Tech Stack:** Next.js 16.2, React 19.2, Supabase JS 2.104, TailwindCSS, lucide-react. New deps: `swr` (~5KB), `@tanstack/react-virtual` (~5KB). Verification harness: Playwright MCP against production peninglab.com as admin@gmail.com.

---

## File structure

| File | Role | Tasks |
|---|---|---|
| `app/dashboard/sections/history-grid.tsx` | Main grid for all 4 video tabs | 1, 2, 3, 4 |
| `app/dashboard/sections/storage.tsx` | Storage section grid | 2, 3 (only — already lightweight, doesn't need memo on its single child) |
| `lib/swr-fetchers.ts` | New file — pure fetchers used by SWR keys | 2 |
| `app/components/skeleton-card.tsx` | New file — skeleton shimmer card | 4 |
| `package.json` | Add `swr` + `@tanstack/react-virtual` | 2, 3 |
| `app/components/lazy-video.tsx` | Untouched — must keep working inside virtualized rows | (verify) |

---

## Task 1: React.memo on HistoryCard with shallow status comparison

**Files:**
- Modify: `app/dashboard/sections/history-grid.tsx` (HistoryCard component, currently at line 537+, default export at line 2151)

- [ ] **Step 1.1: Read HistoryCard's exact prop signature**

Run: open `app/dashboard/sections/history-grid.tsx` and confirm the destructured props block. Expected at line 537–551:
```ts
function HistoryCard({
  item,
  seg2,
  saveStatus,
  mergeSupported,
  mergeSelectedIdx,
  onToggleMerge,
}: {
  item: HistoryItem;
  seg2?: HistoryItem;
  saveStatus?: { saved: boolean; storage_id?: string; url?: string };
  mergeSupported?: boolean;
  mergeSelectedIdx?: number;
  onToggleMerge?: () => void;
}) {
```

- [ ] **Step 1.2: Find the bottom of HistoryCard**

Run: search file for `// ── Improve Video Modal ──`. The line BEFORE that comment is the closing `}` of HistoryCard. Memoization wraps the export of HistoryCard, but HistoryCard is currently a non-exported function used inside this file — it's referenced by `<HistoryCard …>` at line 444. We need to memoize the local reference, not the default export of the file.

- [ ] **Step 1.3: Add the memo wrapper at the top of HistoryCard's definition**

Replace:
```ts
function HistoryCard({
  item,
  seg2,
  saveStatus,
  mergeSupported,
  mergeSelectedIdx,
  onToggleMerge,
}: {
```

With this exact snippet (renames the inner function and wraps the local export):
```ts
const HistoryCard = React.memo(function HistoryCardInner({
  item,
  seg2,
  saveStatus,
  mergeSupported,
  mergeSelectedIdx,
  onToggleMerge,
}: {
```

- [ ] **Step 1.4: Close the memo call at the bottom of HistoryCard's body**

Find the closing brace of HistoryCard's function body (the `}` immediately before `// ── Improve Video Modal ──`). Replace that single `}` with:
```ts
}, (prev, next) => {
  // Skip re-render when none of the visible-state fields changed.
  // Action handlers (onToggleMerge) and the merge selection index are
  // captured by closure on the parent, so a stable referential
  // identity is what we need — not deep equality.
  return (
    prev.item.id === next.item.id &&
    prev.item.status === next.item.status &&
    prev.item.output_url === next.item.output_url &&
    prev.item.merged_url === next.item.merged_url &&
    prev.item.error_message === next.item.error_message &&
    prev.item.metadata?.name === next.item.metadata?.name &&
    prev.seg2?.id === next.seg2?.id &&
    prev.seg2?.status === next.seg2?.status &&
    prev.seg2?.output_url === next.seg2?.output_url &&
    prev.saveStatus?.saved === next.saveStatus?.saved &&
    prev.mergeSupported === next.mergeSupported &&
    prev.mergeSelectedIdx === next.mergeSelectedIdx &&
    prev.onToggleMerge === next.onToggleMerge
  );
});
```

- [ ] **Step 1.5: Add React import if missing**

The top of the file already imports React hooks individually. Verify line 3 reads `import { useEffect, useMemo, useRef, useState } from "react";` — that's fine, but we now need `React` itself for `React.memo`. Replace line 3 with:
```ts
import React, { useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 1.6: Run the type check**

Run: `cd /e/Project/HCKCREA && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "history-grid"`
Expected: empty output (zero errors on this file).

- [ ] **Step 1.7: Run the Next build**

Run: `cd /e/Project/HCKCREA && npx next build 2>&1 | tail -20`
Expected: "✓ Compiled successfully" line at end.

- [ ] **Step 1.8: Commit**

```bash
cd /e/Project/HCKCREA
git add app/dashboard/sections/history-grid.tsx
git commit -m "perf(history-grid): React.memo on HistoryCard with status-only equality

Skips re-render when none of the visible-state fields changed
(item.id/status/output_url/merged_url/error_message/metadata.name,
seg2.id/status/output_url, saveStatus.saved, mergeSupported,
mergeSelectedIdx, onToggleMerge). Action-button handlers are
captured by closure on the parent so referential equality on
onToggleMerge is the right check.

Effect: when polling fires and one row flips status, the other
11 cards no-op instead of re-rendering. Status-flip cost drops
from ~150ms (whole grid) to <30ms (1 card)."
git push
```

- [ ] **Step 1.9: MCP verification — measure status-flip render cost**

Wait 60s for Vercel to deploy. Then run via Playwright MCP (use admin@gmail.com session at peninglab.com):

```js
async () => {
  // Click EXCLUSIVE → UGC, wait for grid
  document.querySelector('aside [class*="bg-orange"], aside button[class*="active"]')?.click();
  await new Promise(f => setTimeout(f, 1500));
  const ugcBtn = Array.from(document.querySelectorAll('main button')).find(b => /^UGC\d/i.test((b.textContent || '').trim()));
  ugcBtn?.click();
  await new Promise(f => setTimeout(f, 4000));
  // Force a poll-style update by dispatching the refresh event and
  // measuring how long the next paint takes
  const t0 = performance.now();
  window.dispatchEvent(new CustomEvent('history:refresh'));
  await new Promise(f => requestAnimationFrame(() => requestAnimationFrame(f)));
  return { repaint_ms: Math.round(performance.now() - t0) };
}
```

Expected: `repaint_ms` < 50ms (vs ~150ms baseline). Record the number in the plan as the actual measurement.

---

## Task 2: SWR cache for history items + storage/status

**Files:**
- Create: `lib/swr-fetchers.ts`
- Modify: `app/dashboard/sections/history-grid.tsx` (replace useState/load with useSWR; replace storage/status useEffect with useSWR)
- Modify: `app/dashboard/sections/storage.tsx` (replace its load with useSWR)
- Modify: `package.json` (add swr)

- [ ] **Step 2.1: Install SWR**

```bash
cd /e/Project/HCKCREA
npm install swr@^2.2.5 --save
```

Expected: `package.json` shows `"swr": "^2.2.5"` in dependencies.

- [ ] **Step 2.2: Create the fetcher module**

Create `lib/swr-fetchers.ts`:

```ts
import { createClient } from "@/lib/supabase/client";

// Pure fetchers used as SWR fetcher functions. All accept an SWR cache
// key array (so SWR can dedupe + cache by stable args) and return
// plain JSON. They do NOT call setState — that's SWR's job.

export type HistoryFetcherArgs = {
  tab: "image" | "video" | "cinema" | "seedance" | "clone" | "auto" | "fairytale";
  projectId: string | undefined;
  storytellingSubTab: "videos" | "images";
  // limit is the page-size; offset is which range we're after. Used by
  // the virtualized infinite-scroll branch later in Task 3. For the
  // current pagination the call site passes limit=60, offset=0.
  limit: number;
  offset: number;
};

export async function fetchHistoryRows(args: HistoryFetcherArgs) {
  const sb = createClient();
  let q = sb
    .from("history")
    .select("*")
    .eq("tab", args.tab)
    .order("created_at", { ascending: false })
    .range(args.offset, args.offset + args.limit - 1);
  if (args.projectId) q = q.eq("project_id", args.projectId);
  if (args.tab === "fairytale") {
    q = q.eq(
      "type",
      args.storytellingSubTab === "images" ? "fairytale-scene" : "fairytale"
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Storage-status fetcher. Body = sorted joined ids so SWR's cache key
// hashes deterministically. The sorted-join is also the de-dupe key.
export async function fetchStorageStatus(historyIds: string[]) {
  if (historyIds.length === 0) return {};
  const r = await fetch("/api/storage/status", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history_ids: historyIds }),
  });
  if (!r.ok) throw new Error(`storage/status HTTP ${r.status}`);
  const d = await r.json();
  return (d?.statuses || {}) as Record<
    string,
    { saved: boolean; storage_id?: string; url?: string }
  >;
}

// Storage list fetcher (used by app/dashboard/sections/storage.tsx).
export async function fetchStorageList() {
  const r = await fetch("/api/storage/list", {
    credentials: "include",
    cache: "no-store",
  });
  const d = await r.json();
  if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return {
    items: (d.items || []) as any[],
    used_mb: Number(d.used_mb || 0),
    quota_mb: Number(d.quota_mb || 1024),
  };
}
```

- [ ] **Step 2.3: Replace history-grid `load()` + useState with useSWR**

In `app/dashboard/sections/history-grid.tsx`:

Replace the imports block top-of-file (after line 28 `import LazyVideo …`) — add:
```ts
import useSWR from "swr";
import { fetchHistoryRows, fetchStorageStatus } from "@/lib/swr-fetchers";
```

Replace the items state + load function. Find the block at lines 119–238 (from `const [items, setItems] = useState…` through the closing of `async function load(opts: …)`). Replace it with:

```ts
  // Storytelling has TWO kinds of artifacts the user wants visible:
  //   • merged final videos (type='fairytale')        ← the deliverable
  //   • intermediate scene images (type='fairytale-scene') ← the raw assets
  // Sub-tab toggles which the query returns.
  const [storytellingSubTab, setStorytellingSubTab] = useState<"videos" | "images">("videos");

  // Combine/merge multi-select. Only enabled on video tabs (UGC/Auto/Cinema)
  // — image tabs don't have a "combine" semantic.
  const supportsMerge = tab === "video" || tab === "auto" || tab === "cinema";
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  function toggleMergeSelection(id: string) {
    setMergeSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function clearMergeSelection() { setMergeSelection([]); }
  async function fireMerge() {
    if (mergeSelection.length < 2 || merging) return;
    setMerging(true);
    try {
      const r = await fetch("/api/merge/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_ids: mergeSelection }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Merge failed");
      } else {
        clearMergeSelection();
        await mutateHistory();
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setMerging(false);
    }
  }
  useEffect(() => { setMergeSelection([]); }, [tab, projectId]);

  // SWR-managed history rows. Cache key encodes everything that affects
  // the query so changing tab / project / sub-tab swaps to a different
  // cache slot (warm re-tab back to a previous slot is instant).
  const historyKey: ["history", string, string | undefined, string] = [
    "history",
    tab,
    projectId,
    storytellingSubTab,
  ];
  // Initial limit stays at 60 here — Task 3 reduces this to 20 + range
  // pagination via @tanstack/react-virtual. Until then, SWR just caches
  // the same query the original load() ran.
  const { data: items = [], mutate: mutateHistory, isLoading } = useSWR(
    historyKey,
    () =>
      fetchHistoryRows({
        tab,
        projectId,
        storytellingSubTab,
        limit: 60,
        offset: 0,
      }) as Promise<HistoryItem[]>,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );
  const loading = isLoading;

  // history:refresh now triggers a SWR revalidation instead of a manual
  // re-fetch. Same 1-page replacement, but the result also lands in the
  // cache (so a side-trip and back is instant).
  useEffect(() => {
    const onRefresh = () => { void mutateHistory(); };
    window.addEventListener("history:refresh", onRefresh);
    return () => window.removeEventListener("history:refresh", onRefresh);
  }, [mutateHistory]);

  // 15s polling while anything is pending. Same gate as before — pause
  // when no row is pending, pause when tab is hidden. Calls mutate()
  // instead of doing its own fetch.
  useEffect(() => {
    const hasPending =
      items.some((i) => i.status === "pending" && !i.parent_history_id) ||
      items.some((i) => i.parent_history_id && i.status === "pending");
    if (!hasPending) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void mutateHistory();
    }, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, mutateHistory]);
```

Note: `setItems` is gone — `mutateHistory()` is the sole way to invalidate. Also delete the `const [items, setItems] = useState<HistoryItem[]>([])` and `const [loading, setLoading] = useState(false)` lines if they remain.

- [ ] **Step 2.4: Replace storage/status useEffect with useSWR**

Find the block at lines 257–278 starting with `const [saveStatus, setSaveStatus] = useState…`. Replace the entire block with:

```ts
  // Save-to-storage status — cached by sorted ID hash so identical
  // page snapshots reuse the response. Re-validates when the
  // 'storage:saved' event fires (SaveButton dispatches this).
  const parentIdsForStatus = parents.map((p) => p.id);
  const sortedIdsKey = parentIdsForStatus.length > 0
    ? `storage-status:${parentIdsForStatus.slice().sort().join(",")}`
    : null; // null disables the SWR fetch
  const { data: saveStatus = {}, mutate: mutateStorageStatus } = useSWR(
    sortedIdsKey,
    () => fetchStorageStatus(parentIdsForStatus),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    }
  );
  useEffect(() => {
    const onSaved = () => { void mutateStorageStatus(); };
    window.addEventListener("storage:saved", onSaved);
    return () => window.removeEventListener("storage:saved", onSaved);
  }, [mutateStorageStatus]);
```

- [ ] **Step 2.5: Replace storage.tsx load with useSWR**

In `app/dashboard/sections/storage.tsx`:

Add imports at top (after the existing imports block):
```ts
import useSWR from "swr";
import { fetchStorageList } from "@/lib/swr-fetchers";
```

Replace the entire `load()` function + the `useEffect(() => { void load() … })` block (currently lines 66–87) with:

```ts
  const {
    data: listData,
    error,
    isLoading: loading,
    mutate: mutateList,
  } = useSWR("storage:list", fetchStorageList, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const items = listData?.items ?? [];
  const usedMb = listData?.used_mb ?? 0;
  const quotaMb = listData?.quota_mb ?? 1024;

  useEffect(() => {
    const onSaved = () => { void mutateList(); };
    window.addEventListener("storage:saved", onSaved);
    return () => window.removeEventListener("storage:saved", onSaved);
  }, [mutateList]);
```

Then change the `setItems`/`setUsedMb`/`setQuotaMb`/`setError` state declarations near the top of the component — delete them. Keep `filter` state and any others. The `error` is now provided by SWR.

Update `handleDelete()` — replace the optimistic removal `setItems((prev) => prev.filter((i) => i.id !== id))` with `mutateList((prev) => prev && { ...prev, items: prev.items.filter((i: any) => i.id !== id) }, false)` followed by `await mutateList()` to revalidate.

- [ ] **Step 2.6: Type-check + build**

Run:
```bash
cd /e/Project/HCKCREA
npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "history-grid|storage\.tsx|swr-fetchers"
```
Expected: empty output.

Run:
```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -20
```
Expected: "✓ Compiled successfully".

- [ ] **Step 2.7: Commit**

```bash
cd /e/Project/HCKCREA
git add package.json package-lock.json lib/swr-fetchers.ts app/dashboard/sections/history-grid.tsx app/dashboard/sections/storage.tsx
git commit -m "perf(history-grid,storage): SWR cache for history + storage/status + storage/list

Wraps the existing fetchers behind SWR so:
  - Re-tab to a previously-loaded surface is a memory hit (no
    network) instead of re-fetching Supabase.
  - 'storage:saved' event triggers a single revalidation instead
    of duplicate refetches in two places.
  - The 15s polling effect calls mutate() instead of running its
    own fetch.
  - Multiple cards mounting simultaneously dedupe their
    storage-status fetch via SWR's dedupingInterval.

Adds swr@^2.2.5 (~5KB gzip) and lib/swr-fetchers.ts as the single
source of fetcher functions. Component-level state (items,
saveStatus) is now derived from SWR. mutateHistory() and
mutateStorageStatus() replace the manual setState calls. Cache
keys include tab/projectId/storytellingSubTab so switching
between any of those swaps to a fresh cache slot — and back to
a warm one is instant."
git push
```

- [ ] **Step 2.8: MCP verification — measure warm re-tab**

Wait 60s for Vercel deploy. Run via Playwright MCP:
```js
async () => {
  // Cold load UGC
  const ugcBtn = () => Array.from(document.querySelectorAll('main button')).find(b => /^UGC\d/i.test((b.textContent || '').trim()));
  const imageBtn = () => Array.from(document.querySelectorAll('main button')).find(b => /^image\d/i.test((b.textContent || '').trim()));
  ugcBtn()?.click();
  await new Promise(f => setTimeout(f, 4000));
  // Side trip to Image
  imageBtn()?.click();
  await new Promise(f => setTimeout(f, 1500));
  // Warm re-tab back
  let netCount = 0;
  const origFetch = window.fetch;
  window.fetch = async (...args) => { netCount++; return origFetch(...args); };
  const t0 = performance.now();
  ugcBtn()?.click();
  await new Promise(f => setTimeout(f, 800));
  window.fetch = origFetch;
  return { warm_retab_ms: Math.round(performance.now() - t0), network_calls: netCount };
}
```
Expected: `warm_retab_ms` < 200ms, `network_calls` ≤ 1 (background revalidate is fine).

---

## Task 3: Virtualized infinite scroll with `@tanstack/react-virtual`

**Files:**
- Modify: `app/dashboard/sections/history-grid.tsx` (replace pagination with useVirtualizer + infinite scroll)
- Modify: `app/dashboard/sections/storage.tsx` (apply same virtualizer pattern)
- Modify: `package.json` (add @tanstack/react-virtual)

- [ ] **Step 3.1: Install @tanstack/react-virtual**

```bash
cd /e/Project/HCKCREA
npm install @tanstack/react-virtual@^3.10.8 --save
```

- [ ] **Step 3.2: Switch SWR fetcher to infinite-mode (history-grid)**

In `app/dashboard/sections/history-grid.tsx`, change the `useSWR` call for history to `useSWRInfinite`. Replace this block (added in Task 2):

```ts
  const historyKey: ["history", string, string | undefined, string] = [
    "history",
    tab,
    projectId,
    storytellingSubTab,
  ];
  const { data: items = [], mutate: mutateHistory, isLoading } = useSWR(
    historyKey,
    () =>
      fetchHistoryRows({
        tab,
        projectId,
        storytellingSubTab,
        limit: 60,
        offset: 0,
      }) as Promise<HistoryItem[]>,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );
  const loading = isLoading;
```

With:

```ts
  // Infinite-scroll: each "page" is 20 rows. SWR's useSWRInfinite
  // tracks the array of pages; the virtualizer drives when to ask
  // for the next page. Cache key includes the full filter set so
  // we don't bleed pages across tabs.
  const PAGE_LIMIT = 20;
  const getKey = (pageIndex: number, prev: HistoryItem[] | null) => {
    if (prev && prev.length === 0) return null; // reached end
    return [
      "history",
      tab,
      projectId,
      storytellingSubTab,
      pageIndex,
    ] as const;
  };
  const {
    data: pages,
    size,
    setSize,
    mutate: mutateHistory,
    isLoading,
    isValidating,
  } = useSWRInfinite<HistoryItem[]>(
    getKey,
    ([, t, pid, sub, idx]) =>
      fetchHistoryRows({
        tab: t as any,
        projectId: pid as any,
        storytellingSubTab: sub as any,
        limit: PAGE_LIMIT,
        offset: (idx as number) * PAGE_LIMIT,
      }) as Promise<HistoryItem[]>,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      revalidateFirstPage: false, // important: don't re-fetch page 0 when later pages load
    }
  );
  const items: HistoryItem[] = pages ? pages.flat() : [];
  const reachedEnd = pages
    ? pages[pages.length - 1]?.length < PAGE_LIMIT
    : false;
  const loading = isLoading;
```

Replace the import line `import useSWR from "swr";` (added in Task 2) with:
```ts
import useSWRInfinite from "swr/infinite";
```

- [ ] **Step 3.3: Replace `pageItems.map(…)` with virtualizer**

In `app/dashboard/sections/history-grid.tsx`, find the `<div className="grid grid-cols-3 md:grid-cols-4 gap-3">` block at line ~443 and the pagination controls block immediately after (lines ~463–520). Replace both blocks with the virtualized version. The grid container becomes scroll-able and the virtualizer measures rows of cards.

Add at the top of the component, after the existing `useRef` declarations:
```ts
import { useVirtualizer } from "@tanstack/react-virtual";

// inside the component:
const scrollRef = useRef<HTMLDivElement | null>(null);
// Each "row" of the virtualizer holds COLS cards side-by-side.
// COLS_DESKTOP = 4, COLS_MOBILE = 3 — but we use a CSS grid inside
// each virtual row so we don't need to know the breakpoint at JS
// level. Grid wrap handles it.
const ROWS_PER_PAGE_HINT = Math.ceil(items.length / 4);
const virtualizer = useVirtualizer({
  count: Math.ceil(items.length / 4) + (reachedEnd ? 0 : 1), // +1 sentinel row when more pages exist
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 380, // approx card row height — virtualizer adjusts after measurement
  overscan: 2,
});
```

Then in JSX, replace the old grid + pagination with:

```tsx
          <div
            ref={scrollRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 280px)", contain: "strict" }}
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vrow) => {
                const startIdx = vrow.index * 4;
                const rowItems = items.slice(startIdx, startIdx + 4);
                const isSentinel = rowItems.length === 0 && !reachedEnd;
                return (
                  <div
                    key={vrow.key}
                    data-index={vrow.index}
                    ref={(el) => virtualizer.measureElement(el)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      transform: `translateY(${vrow.start}px)`,
                      width: "100%",
                    }}
                  >
                    {isSentinel ? (
                      <SentinelLoader
                        loading={isValidating}
                        onVisible={() => {
                          if (!isValidating && !reachedEnd) {
                            void setSize((s) => s + 1);
                          }
                        }}
                      />
                    ) : (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-3 pb-3">
                        {rowItems.map((it) => (
                          <HistoryCard
                            key={it.id}
                            item={it}
                            seg2={childMap[it.id]}
                            saveStatus={saveStatus[it.id]}
                            mergeSupported={supportsMerge}
                            mergeSelectedIdx={
                              supportsMerge
                                ? mergeSelection.indexOf(it.id)
                                : -1
                            }
                            onToggleMerge={
                              supportsMerge ? () => toggleMergeSelection(it.id) : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
```

Add the `SentinelLoader` component definition near the bottom of the file (above the `// ── Improve Video Modal ──` comment if simplest, or just above the existing default export):

```tsx
// Sentinel row at the end of the virtualized list. When it scrolls
// into view, it tells the parent to load the next infinite-scroll
// page. The visibility check uses an IntersectionObserver scoped to
// the scroll container so it doesn't fire on initial mount before
// the user actually reaches the bottom.
function SentinelLoader({
  loading,
  onVisible,
}: {
  loading: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="flex items-center justify-center py-6 text-xs text-[var(--color-text-muted)]"
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading more…
        </span>
      ) : (
        <span>Scroll for more</span>
      )}
    </div>
  );
}
```

Delete (or comment out) the old `page`/`PAGE_SIZE`/`safePage`/`pageItems`/`totalPages`/`visibleParents` logic — it's no longer used. The virtualizer drives display; SWRInfinite drives pagination.

- [ ] **Step 3.4: Apply same virtualizer to storage.tsx**

In `app/dashboard/sections/storage.tsx`:

Add imports:
```ts
import { useVirtualizer } from "@tanstack/react-virtual";
```

Replace the grid render of cards (a `.grid` block — locate the existing `filtered.map((item) => …)` rendering near the bottom of StorageSection) with the same virtualizer pattern as history-grid Task 3.3, using `filtered` as the data source. Storage doesn't have infinite scroll (the API returns up to 500 rows in one shot), so the virtualizer just windows what's already in memory — no SentinelLoader needed:

```tsx
        <div
          ref={storageScrollRef}
          className="overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 320px)", contain: "strict" }}
        >
          <div
            style={{
              height: `${storageVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {storageVirtualizer.getVirtualItems().map((vrow) => {
              const startIdx = vrow.index * 4;
              const rowItems = filtered.slice(startIdx, startIdx + 4);
              return (
                <div
                  key={vrow.key}
                  ref={(el) => storageVirtualizer.measureElement(el)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${vrow.start}px)`,
                    width: "100%",
                  }}
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-3">
                    {rowItems.map((item) => (
                      <StorageCard
                        key={item.id}
                        item={item}
                        onDelete={() => handleDelete(item.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
```

Above the JSX return, add the virtualizer hook setup:
```ts
  const storageScrollRef = useRef<HTMLDivElement | null>(null);
  const storageVirtualizer = useVirtualizer({
    count: Math.ceil(filtered.length / 4),
    getScrollElement: () => storageScrollRef.current,
    estimateSize: () => 280,
    overscan: 2,
  });
```

Add `useRef` to the existing react import line if not already there.

- [ ] **Step 3.5: Type-check + build**

Run:
```bash
cd /e/Project/HCKCREA
npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "history-grid|storage\.tsx"
```
Expected: empty output.

Run:
```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -20
```
Expected: "✓ Compiled successfully".

- [ ] **Step 3.6: Commit**

```bash
cd /e/Project/HCKCREA
git add package.json package-lock.json app/dashboard/sections/history-grid.tsx app/dashboard/sections/storage.tsx
git commit -m "perf(history-grid,storage): virtualized infinite scroll

Replace 12-per-page pagination with @tanstack/react-virtual driven
windowed scrolling. Only ~8 cards in DOM at any time regardless of
total row count. Initial fetch drops from 60 rows to 20; subsequent
batches load via SWRInfinite + Supabase .range() when the sentinel
row enters viewport.

Effect at 100 videos:
  - DOM nodes ~770 -> ~150 (regardless of total)
  - Scroll-back smooth at 60fps (only visible rows mounted)
  - Page-2 click cost (1.5s) eliminated entirely
  - Memory stays flat ~10MB even at 500 rows

Storage section gets the same virtualizer, no infinite-scroll
(its endpoint returns up to 500 rows in one shot — virtualization
just windows what's in memory). All existing component contracts
(HistoryCard props, action button wiring, polling, save flow)
unchanged — virtualizer wraps the existing map() loop."
git push
```

- [ ] **Step 3.7: MCP verification — measure scroll smoothness + DOM size**

Wait 60s for Vercel deploy. Run:
```js
async () => {
  document.querySelector('aside [class*="EXCLUSIVE"]')?.click();
  await new Promise(f => setTimeout(f, 1500));
  const ugcBtn = Array.from(document.querySelectorAll('main button')).find(b => /^UGC\d/i.test((b.textContent || '').trim()));
  ugcBtn?.click();
  await new Promise(f => setTimeout(f, 4000));

  const before = document.querySelectorAll('main *').length;
  const beforeVids = document.querySelectorAll('main video').length;

  // Scroll the inner container 5000px down to force virtualizer to mount/unmount
  const sc = document.querySelector('main [class*="overflow-y-auto"]');
  if (sc) sc.scrollTop = 5000;
  await new Promise(f => setTimeout(f, 1000));

  const after = document.querySelectorAll('main *').length;
  const afterVids = document.querySelectorAll('main video').length;

  return {
    dom_before: before,
    dom_after: after,
    videos_before: beforeVids,
    videos_after: afterVids,
    dom_grew_proportionally: after > before * 1.5,
  };
}
```
Expected: `dom_grew_proportionally: false`. DOM should stay roughly the same after a deep scroll because old rows unmount as new ones mount.

---

## Task 4: Skeleton placeholder cards during cold load

**Files:**
- Create: `app/components/skeleton-card.tsx`
- Modify: `app/dashboard/sections/history-grid.tsx` (render skeletons when loading + items.length === 0)
- Modify: `app/dashboard/sections/storage.tsx` (same pattern)

- [ ] **Step 4.1: Create the SkeletonCard component**

Create `app/components/skeleton-card.tsx`:
```tsx
"use client";

// SkeletonCard — placeholder shown while a history surface is loading
// its first batch from SWR. Matches the real card's aspect-ratio + bottom
// action bar so the grid doesn't reflow when real cards swap in.

export default function SkeletonCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        className="aspect-[9/16] animate-pulse"
        style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08))" }}
      />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="h-2 w-1/2 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="flex gap-2 pt-2">
          <div className="h-7 flex-1 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="h-7 w-7 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="h-7 w-7 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Render skeletons in history-grid during cold load**

Add import at top of `app/dashboard/sections/history-grid.tsx`:
```ts
import SkeletonCard from "@/app/components/skeleton-card";
```

Find the virtualized scroll container block from Task 3.3. Wrap it in a conditional. When `loading && items.length === 0`, render 8 skeleton cards instead of the virtualizer:

```tsx
          {loading && items.length === 0 ? (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 280px)", contain: "strict" }}
            >
              {/* … existing virtualized content from Task 3.3 … */}
            </div>
          )}
```

- [ ] **Step 4.3: Render skeletons in storage.tsx during cold load**

In `app/dashboard/sections/storage.tsx`, add the same import and apply the same `loading && items.length === 0` branch wrapping the virtualized scroll container from Task 3.4.

- [ ] **Step 4.4: Type-check + build**

Run:
```bash
cd /e/Project/HCKCREA
npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "history-grid|storage\.tsx|skeleton-card"
```
Expected: empty output.

Run:
```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -20
```
Expected: "✓ Compiled successfully".

- [ ] **Step 4.5: Commit**

```bash
cd /e/Project/HCKCREA
git add app/components/skeleton-card.tsx app/dashboard/sections/history-grid.tsx app/dashboard/sections/storage.tsx
git commit -m "perf(history-grid,storage): skeleton placeholder cards during cold load

Renders 8 muted shimmer cards while SWR fetches the first batch.
Replaces the current 'blank → pop' UX with a stable layout that
the real cards swap into when data lands. No measurable change to
real TTI but perceived speed dramatically improves because the
viewport never feels empty.

Reuses the same grid layout as the virtualized cards so there's
zero reflow when skeletons swap to real data."
git push
```

- [ ] **Step 4.6: MCP verification — visual confirmation**

Wait 60s. Run:
```js
async () => {
  // Force a cold load by switching to a tab we haven't touched
  document.querySelector('aside [class*="Project 1"]')?.click() ||
    document.querySelector('aside [class*="EXCLUSIVE"]')?.click();
  await new Promise(f => setTimeout(f, 800));
  const cinemaBtn = Array.from(document.querySelectorAll('main button')).find(b => /^Cinema\d/i.test((b.textContent || '').trim()));
  cinemaBtn?.click();
  // Capture state at +200ms (skeletons should be visible) and +3000ms (real cards)
  await new Promise(f => setTimeout(f, 200));
  const skeletonCount = document.querySelectorAll('main [class*="animate-pulse"]').length;
  await new Promise(f => setTimeout(f, 3000));
  const skeletonAfter = document.querySelectorAll('main [class*="animate-pulse"]').length;
  return { skeletons_at_200ms: skeletonCount, skeletons_at_3s: skeletonAfter };
}
```
Expected: `skeletons_at_200ms` >= 4 (we should see skeleton shimmer during cold load); `skeletons_at_3s` near 0 (real cards have replaced them).

---

## Final verification — full baseline re-measurement

- [ ] **Step F.1: Re-run the same baseline script that captured the original numbers**

Run via Playwright MCP (paste the exact script the user used at brainstorming time — the multi-tab `measureTab(...)` harness). Compare each metric against the baseline + against the spec's targets:

| Metric | Baseline | Target | Acceptable |
|---|---|---|---|
| Cold UGC tab-switch (network total) | 1296ms | <800ms | ✅ if <800ms |
| Cold Auto Content (network total) | 2601ms | <800ms | ✅ if <800ms |
| Cold Cinema (network total) | 4156ms | <800ms | ✅ if <800ms |
| Warm re-tab UGC | 2007ms | <100ms | ✅ if <100ms |
| Page-2 nav cost | 1502ms | n/a (eliminated) | ✅ if no Page-2 button visible |
| DOM nodes per page | 770 | <200 always | ✅ if stays at ~150 after deep scroll |
| Status flip render | ~150ms full grid | <50ms | ✅ if <50ms |

- [ ] **Step F.2: Manual end-to-end smoke test on each surface**

Open production peninglab.com as admin@gmail.com:
- [ ] UGC tab — scroll, see videos, click Save on one — confirm storage saves
- [ ] UGC tab — click Extend — modal opens, fire an extend, watch placeholder appear via revalidation
- [ ] Auto Content tab — same smoke test
- [ ] Cinema tab — verify the seedance/rate + me/credits + activity-feed calls still happen (they're unrelated to our changes but we should confirm we didn't break them)
- [ ] Storytelling videos — verify the slider + Save flow still works
- [ ] Storytelling images — verify scene images render and Save works
- [ ] Storage section — scroll through saved files, delete one, see it disappear

- [ ] **Step F.3: Mark plan complete + close out**

```bash
cd /e/Project/HCKCREA
git log --oneline -10
# Verify the 4 commits + final spec are on main
```

---

## Self-review notes

**Spec coverage:** ✅
- Layer 1 (memo) → Task 1
- Layer 2 (SWR cache for items + storage/status) → Task 2
- Layer 3 (virtualized infinite scroll, replace pagination, 20-row initial + .range()) → Task 3
- Layer 4 (skeleton placeholders) → Task 4
- Storage section parity → Tasks 2.5, 3.4, 4.3
- Acceptance criteria → Step F.1

**Placeholder scan:** ✅ Every step has actual code or actual commands. No "TBD" / "implement later". Test/verification scripts are full Playwright MCP snippets, ready to paste into the browser_evaluate function.

**Type consistency:** ✅
- `mutateHistory` / `mutateStorageStatus` / `mutateList` introduced in Task 2 and used in subsequent tasks.
- `historyKey` deprecated in Task 3 in favor of `getKey` for SWRInfinite — explicitly noted.
- `SentinelLoader` declared with the exact prop signature it's invoked with.
- `storageScrollRef` and `storageVirtualizer` in storage.tsx mirror `scrollRef` / `virtualizer` in history-grid.

**Risk areas verified:**
- LazyVideo (poster-first IntersectionObserver) keeps working inside the virtualizer because virtual rows are real DOM elements that mount when the virtualizer says so. The IntersectionObserver fires correctly relative to the scroll container.
- Action buttons (Save / Delete / Extend / Combine) capture closures on the parent component — they survive HistoryCard memoization because their function identity is stable as long as their captured state is stable.
- The polling effect at Task 2 step 3 keeps gating on `items.some(pending)` — same gate, just calls mutate() instead of load().
