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
};

type Counts = { video: number; image: number; total: number };

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
  const [loading, setLoading] = useState(true);

  const [start, setStart] = useState(startOfMonthLocal());
  const [end, setEnd] = useState(localDateStr());
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "video" | "image">("all");

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
    } finally {
      setLoading(false);
    }
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
        <button
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

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
            onChange={(e) => setStart(e.target.value)}
            max={end}
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
            onChange={(e) => setEnd(e.target.value)}
            min={start}
            max={localDateStr()}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
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
                  <th className="px-4 py-3">When (MYT)</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Tab</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-[var(--color-text-primary)]">
                      {formatMY(r.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-primary)]">
                      {r.email}
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
                    <td
                      className="px-4 py-3 text-xs text-[var(--color-text-primary)] max-w-[480px]"
                      title={r.error}
                    >
                      <div
                        className="line-clamp-2 break-words"
                        style={{ color: "rgb(248, 113, 113)" }}
                      >
                        {r.error}
                      </div>
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
