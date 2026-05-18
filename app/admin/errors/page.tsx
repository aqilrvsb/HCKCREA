"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Loader2,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  RefreshCcw,
  RotateCw,
  Check,
  Trash2,
} from "lucide-react";
import { localDateStr, startOfMonthLocal } from "@/lib/date-util";

type ErrorRow = {
  id: string;
  user_id: string;
  email: string;
  tab: string;
  kind: "image" | "video";
  slot: string;
  model: string;
  error: string;
  created_at: string;
  prompt: string;
  task_id: string;
  auto_count: number;
};

type Counts = { video: number; image: number; total: number };
type CronInfo = {
  at?: string;
  scanned?: number;
  eligible?: number;
  resubmitted?: number;
  exhausted?: number;
  ineligible?: number;
} | null;

// Pretty slot label: "p6-a" → "P6 A", "p2-b" → "P2 B", "p5" → "P5".
function prettySlot(slot: string): string {
  if (!slot) return "—";
  const s = slot.toUpperCase();
  return s
    .replace(/^P2-([AB])$/, "P2 $1")
    .replace(/^P6-([A-H])$/, "P6 $1");
}

// Format an ISO timestamp as Malaysia-local "DD MMM YYYY · HH:mm" so
// the table reads naturally without dropping into the user's browser
// locale (which on Vercel preview could be UTC).
function formatMY(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(d).replace(",", " ·");
}

export default function AdminErrors() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ video: 0, image: 0, total: 0 });
  const [cron, setCron] = useState<CronInfo>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [activeRange, setActiveRange] = useState<{ start: string; end: string }>({
    start: localDateStr(),
    end: localDateStr(),
  });
  // Bulk delete state — set of selected row ids.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [start, setStart] = useState(localDateStr());
  const [end, setEnd] = useState(localDateStr());
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "video" | "image">("all");
  // Per-row resubmit state: "idle" | "loading" | "done" | error message.
  const [resubmitState, setResubmitState] = useState<Record<string, string>>({});
  // Bulk resubmit state — true while the resubmitSelected loop is firing.
  const [bulkResubmitting, setBulkResubmitting] = useState(false);
  // Bulk resubmit progress (X of Y submitted so far) — shown in the button.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // Bulk delete the selected rows. Fires sequentially so partial
  // failures show up in the UI rather than burying every error in
  // one Promise.all rejection.
  async function deleteSelected() {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selected.size} error row${selected.size > 1 ? "s" : ""}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    const ids = Array.from(selected);
    const removedKinds: Array<"video" | "image"> = [];
    for (const id of ids) {
      try {
        const r = await fetch(
          `/api/history/delete?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (r.ok) {
          const row = rows.find((x) => x.id === id);
          if (row) removedKinds.push(row.kind);
          setRows((rs) => rs.filter((x) => x.id !== id));
        }
      } catch {
        // continue with remaining ids
      }
    }
    setCounts((c) => {
      const vDrop = removedKinds.filter((k) => k === "video").length;
      const iDrop = removedKinds.filter((k) => k === "image").length;
      return {
        total: Math.max(0, c.total - removedKinds.length),
        video: Math.max(0, c.video - vDrop),
        image: Math.max(0, c.image - iDrop),
      };
    });
    setSelected(new Set());
    setDeleting(false);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) => {
      const visibleIds = filtered.map((r) => r.id);
      const allSelected = visibleIds.every((id) => s.has(id));
      if (allSelected) {
        const next = new Set(s);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(s);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  async function resubmit(rowId: string) {
    setResubmitState((s) => ({ ...s, [rowId]: "loading" }));
    try {
      const r = await fetch("/api/history/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: rowId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResubmitState((s) => ({
          ...s,
          [rowId]: d?.error || "Retry failed",
        }));
        return;
      }
      setResubmitState((s) => ({ ...s, [rowId]: "done" }));
      // Drop the row from the visible list — it's no longer failed.
      const removed = rows.find((x) => x.id === rowId);
      setRows((rs) => rs.filter((x) => x.id !== rowId));
      setCounts((c) => ({
        total: Math.max(0, c.total - 1),
        video:
          removed?.kind === "video" ? Math.max(0, c.video - 1) : c.video,
        image:
          removed?.kind === "image" ? Math.max(0, c.image - 1) : c.image,
      }));
    } catch (e: any) {
      setResubmitState((s) => ({
        ...s,
        [rowId]: e?.message || "Network error",
      }));
    }
  }

  // Bulk resubmit. Two modes:
  //   • If user has selected rows → resubmit only the selected
  //   • If nothing selected → resubmit ALL currently-visible filtered rows
  // Fires sequentially (1-by-1, no Promise.all) so we don't hammer the
  // backend with N parallel retry calls. Progress bar updates after each
  // submission so the admin sees movement on long lists.
  async function resubmitSelected() {
    const ids = selected.size > 0
      ? Array.from(selected)
      : filtered.map((r) => r.id);
    if (ids.length === 0) return;

    const confirmed = window.confirm(
      `Resubmit ${ids.length} failed row${ids.length > 1 ? "s" : ""}? ` +
      `Each will fire a fresh generation through the cascade — same cost as a manual retry per row.`
    );
    if (!confirmed) return;

    setBulkResubmitting(true);
    setBulkProgress({ done: 0, total: ids.length });
    const removedKinds: Array<"video" | "image"> = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        setResubmitState((s) => ({ ...s, [id]: "loading" }));
        const r = await fetch("/api/history/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history_id: id }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          const row = rows.find((x) => x.id === id);
          if (row) removedKinds.push(row.kind);
          setRows((rs) => rs.filter((x) => x.id !== id));
          setResubmitState((s) => ({ ...s, [id]: "done" }));
        } else {
          setResubmitState((s) => ({
            ...s,
            [id]: d?.error || "Retry failed",
          }));
        }
      } catch (e: any) {
        setResubmitState((s) => ({
          ...s,
          [id]: e?.message || "Network error",
        }));
      }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    // Update counts once at the end so we don't flash N times.
    setCounts((c) => {
      const vDrop = removedKinds.filter((k) => k === "video").length;
      const iDrop = removedKinds.filter((k) => k === "image").length;
      return {
        total: Math.max(0, c.total - removedKinds.length),
        video: Math.max(0, c.video - vDrop),
        image: Math.max(0, c.image - iDrop),
      };
    });
    setSelected(new Set());
    setBulkResubmitting(false);
    setBulkProgress(null);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/errors?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      setRows(d?.rows || []);
      setCounts(d?.counts || { video: 0, image: 0, total: 0 });
      setCron(d?.cron || null);
      setActiveRange({ start, end });
      setFetchedAt(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kuala_Lumpur",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date())
      );
    } finally {
      setLoading(false);
    }
  }

  // Human-friendly "X min ago" since the last cron heartbeat.
  function cronAgo(): { label: string; stale: boolean } {
    if (!cron?.at) return { label: "Never run", stale: true };
    const diffMs = Date.now() - new Date(cron.at).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60_000));
    if (mins < 1) return { label: "Just now", stale: false };
    if (mins < 60) return { label: `${mins} min ago`, stale: mins > 20 };
    const hrs = Math.floor(mins / 60);
    return { label: `${hrs}h ${mins % 60}m ago`, stale: true };
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        r.email.toLowerCase().includes(q) ||
        r.tab.toLowerCase().includes(q) ||
        r.slot.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.error.toLowerCase().includes(q)
      );
    });
  }, [rows, search, kindFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
          }}
        >
          <AlertTriangle
            className="w-6 h-6"
            style={{ color: "rgb(239, 68, 68)" }}
            strokeWidth={2.2}
          />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--color-text-primary)]">
            Errors
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Rows that stayed failed after all cascades + retries.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Bulk Resubmit — fires the retry endpoint for every selected
              row (or every visible row if nothing selected). Sequential
              so we don't hammer the cascade with N parallel calls. */}
          <button
            onClick={() => void resubmitSelected()}
            disabled={bulkResubmitting || filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-60"
            style={{
              background: "rgba(245, 158, 11, 0.18)",
              border: "1px solid rgba(245, 158, 11, 0.5)",
              color: "rgb(245, 158, 11)",
            }}
            title={
              selected.size > 0
                ? `Resubmit ${selected.size} selected row${selected.size > 1 ? "s" : ""}`
                : `Resubmit all ${filtered.length} visible row${filtered.length > 1 ? "s" : ""}`
            }
          >
            {bulkResubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : "..."}
              </>
            ) : (
              <>
                <RotateCw className="w-3.5 h-3.5" />
                Resubmit {selected.size > 0 ? selected.size : "all"}
              </>
            )}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => void deleteSelected()}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-60"
              style={{
                background: "rgba(239, 68, 68, 0.18)",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                color: "rgb(239, 68, 68)",
              }}
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete {selected.size}
            </button>
          )}
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Cron heartbeat */}
      {(() => {
        const ago = cronAgo();
        return (
          <div
            className="rounded-2xl p-3 flex flex-wrap items-center gap-3 text-xs"
            style={{
              background: ago.stale
                ? "rgba(239, 68, 68, 0.08)"
                : "rgba(34, 197, 94, 0.08)",
              border: `1px solid ${ago.stale ? "rgba(239, 68, 68, 0.35)" : "rgba(34, 197, 94, 0.35)"}`,
              color: "var(--color-text-primary)",
            }}
          >
            <span className="font-bold uppercase tracking-widest text-[10px]">
              Auto-resubmit cron
            </span>
            <span
              className="font-bold"
              style={{ color: ago.stale ? "rgb(239, 68, 68)" : "rgb(34, 197, 94)" }}
            >
              {ago.label}
            </span>
            {cron && (
              <span className="text-[var(--color-text-secondary)]">
                Last batch: scanned {cron.scanned ?? 0} · resubmitted{" "}
                {cron.resubmitted ?? 0} · ineligible {cron.ineligible ?? 0} ·
                exhausted {cron.exhausted ?? 0}
              </span>
            )}
            <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">
              Schedule: every 8 min · scans last 24h · max 3 auto-retries / row
            </span>
          </div>
        );
      })()}

      {/* Count cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <CountCard
          label="Total errors"
          value={counts.total}
          tone="red"
          icon={<AlertTriangle className="w-5 h-5" />}
        />
        <CountCard
          label="Video errors"
          value={counts.video}
          tone="orange"
          icon={<VideoIcon className="w-5 h-5" />}
        />
        <CountCard
          label="Image errors"
          value={counts.image}
          tone="amber"
          icon={<ImageIcon className="w-5 h-5" />}
        />
      </div>

      {/* Filters */}
      <div
        className="rounded-2xl p-4 flex flex-wrap items-end gap-3"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)]">
            <Calendar className="inline w-3 h-3 mr-1" /> From
          </label>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              setStart(v);
              if (v > end) setEnd(v);
            }}
            max={localDateStr()}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)]">
            <Calendar className="inline w-3 h-3 mr-1" /> To
          </label>
          <input
            type="date"
            value={end}
            onChange={(e) => {
              const v = e.target.value;
              setEnd(v);
              if (v < start) setStart(v);
            }}
            max={localDateStr()}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>

        {/* Quick preset buttons */}
        <div className="flex gap-1">
          {[
            { label: "Today", days: 0 },
            { label: "7d", days: 6 },
            { label: "Month", days: -1 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const today = localDateStr();
                if (p.days === -1) {
                  setStart(startOfMonthLocal());
                  setEnd(today);
                } else if (p.days === 0) {
                  setStart(today);
                  setEnd(today);
                } else {
                  const d = new Date();
                  d.setDate(d.getDate() - p.days);
                  setStart(localDateStr(d));
                  setEnd(today);
                }
              }}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(["all", "video", "image"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className="px-3 py-2 rounded-lg text-xs font-bold capitalize"
              style={{
                background:
                  kindFilter === k
                    ? "var(--color-orange)"
                    : "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color:
                  kindFilter === k ? "#1a1a1a" : "var(--color-text-primary)",
              }}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[200px] flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)]">
            <Search className="inline w-3 h-3 mr-1" /> Search
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email, tab, provider, model, error…"
            className="px-3 py-2 rounded-lg text-sm w-full"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
      </div>

      {/* Active filter status */}
      <div
        className="text-xs flex flex-wrap items-center gap-2"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <span>
          Showing <b style={{ color: "var(--color-text-primary)" }}>{filtered.length}</b> /
          <b style={{ color: "var(--color-text-primary)" }}> {rows.length}</b> rows
        </span>
        <span>·</span>
        <span>
          From <b style={{ color: "var(--color-text-primary)" }}>{activeRange.start}</b>
          {" → "}
          <b style={{ color: "var(--color-text-primary)" }}>{activeRange.end}</b>{" "}
          (MYT)
        </span>
        {fetchedAt && (
          <>
            <span>·</span>
            <span>Fetched at {fetchedAt} MYT</span>
          </>
        )}
      </div>

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        {loading ? (
          <div className="p-12 flex items-center justify-center text-[var(--color-text-secondary)]">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-[var(--color-text-secondary)]">
            No errors in this range. 🎉
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] uppercase tracking-widest font-bold"
                  style={{
                    background: "var(--color-bg)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={
                        filtered.length > 0 &&
                        filtered.every((r) => selected.has(r.id))
                      }
                      onChange={toggleSelectAll}
                      className="cursor-pointer w-4 h-4 accent-[var(--color-orange)]"
                      title="Select all visible rows"
                    />
                  </th>
                  <th className="px-4 py-3">When (MYT)</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Tab</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3 text-center">Auto Retries</th>
                  <th className="px-4 py-3">Error</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{
                      borderColor: "var(--color-border)",
                      background: selected.has(r.id)
                        ? "rgba(239, 68, 68, 0.06)"
                        : undefined,
                    }}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        className="cursor-pointer w-4 h-4 accent-[var(--color-orange)]"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-[var(--color-text-primary)]">
                      {formatMY(r.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-primary)]">
                      <div>{r.email}</div>
                      {r.task_id && (
                        <div
                          className="font-mono text-[10px] text-[var(--color-text-secondary)] mt-0.5"
                          title={r.task_id}
                        >
                          {r.task_id.slice(0, 12)}…
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                        style={
                          r.kind === "video"
                            ? {
                                background: "rgba(251, 146, 60, 0.15)",
                                color: "rgb(251, 146, 60)",
                              }
                            : {
                                background: "rgba(250, 204, 21, 0.18)",
                                color: "rgb(202, 138, 4)",
                              }
                        }
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">
                      {r.tab}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-[var(--color-text-primary)]">
                      {prettySlot(r.slot)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-[var(--color-text-secondary)]">
                      {r.model || "—"}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {(() => {
                        const max = 3; // MAX_AUTO_RESUBMIT
                        const exhausted = r.auto_count >= max;
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                            style={
                              exhausted
                                ? {
                                    background: "rgba(239, 68, 68, 0.15)",
                                    color: "rgb(239, 68, 68)",
                                    border: "1px solid rgba(239, 68, 68, 0.4)",
                                  }
                                : r.auto_count > 0
                                  ? {
                                      background: "rgba(251, 146, 60, 0.15)",
                                      color: "rgb(251, 146, 60)",
                                      border: "1px solid rgba(251, 146, 60, 0.4)",
                                    }
                                  : {
                                      background: "rgba(120, 120, 120, 0.12)",
                                      color: "rgb(156, 163, 175)",
                                      border: "1px solid rgba(120, 120, 120, 0.3)",
                                    }
                            }
                            title={
                              exhausted
                                ? "Cron won't auto-retry anymore — admin must manually Resubmit"
                                : `${r.auto_count} of ${max} auto-retries used`
                            }
                          >
                            {r.auto_count} / {max}
                            {exhausted && " 🚫"}
                          </span>
                        );
                      })()}
                    </td>
                    <td
                      className="px-4 py-3 text-xs text-[var(--color-text-primary)] max-w-[640px] align-top"
                      title={r.error}
                    >
                      <div
                        className="break-words whitespace-pre-wrap"
                        style={{ color: "rgb(248, 113, 113)" }}
                      >
                        {r.error}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(() => {
                        const st = resubmitState[r.id] || "idle";
                        if (st === "loading") {
                          return (
                            <button
                              disabled
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                              style={{
                                background: "var(--color-bg)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-text-secondary)",
                              }}
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Resubmitting…
                            </button>
                          );
                        }
                        if (st === "done") {
                          return (
                            <span
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                              style={{
                                background: "rgba(34, 197, 94, 0.12)",
                                border: "1px solid rgba(34, 197, 94, 0.4)",
                                color: "rgb(34, 197, 94)",
                              }}
                            >
                              <Check className="w-3.5 h-3.5" /> Sent
                            </span>
                          );
                        }
                        const errMsg = st !== "idle" ? st : null;
                        return (
                          <div className="inline-flex flex-col items-end gap-1">
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => void resubmit(r.id)}
                                title="Resubmit this row through the fallback cascade"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:translate-x-0.5"
                                style={{
                                  background: "var(--color-orange)",
                                  border: "1px solid var(--color-orange)",
                                  color: "#1a1a1a",
                                }}
                              >
                                <RotateCw className="w-3.5 h-3.5" /> Resubmit
                              </button>
                              <button
                                onClick={() => {
                                  setSelected(new Set([r.id]));
                                  void deleteSelected();
                                }}
                                title="Delete this row"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:translate-x-0.5"
                                style={{
                                  background: "rgba(239, 68, 68, 0.12)",
                                  border: "1px solid rgba(239, 68, 68, 0.4)",
                                  color: "rgb(239, 68, 68)",
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {errMsg && (
                              <span
                                className="text-[10px] max-w-[180px] truncate"
                                style={{ color: "rgb(248, 113, 113)" }}
                                title={errMsg}
                              >
                                {errMsg}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CountCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "red" | "orange" | "amber";
  icon: React.ReactNode;
}) {
  const palette: Record<typeof tone, { bg: string; fg: string; border: string }> = {
    red: {
      bg: "rgba(239, 68, 68, 0.10)",
      fg: "rgb(239, 68, 68)",
      border: "rgba(239, 68, 68, 0.35)",
    },
    orange: {
      bg: "rgba(251, 146, 60, 0.10)",
      fg: "rgb(251, 146, 60)",
      border: "rgba(251, 146, 60, 0.35)",
    },
    amber: {
      bg: "rgba(250, 204, 21, 0.12)",
      fg: "rgb(202, 138, 4)",
      border: "rgba(250, 204, 21, 0.4)",
    },
  };
  const p = palette[tone];
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{ background: p.bg, border: `1px solid ${p.border}` }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.15)", color: p.fg }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: p.fg }}>
          {label}
        </div>
        <div className="text-3xl font-extrabold leading-none mt-1" style={{ color: p.fg }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
