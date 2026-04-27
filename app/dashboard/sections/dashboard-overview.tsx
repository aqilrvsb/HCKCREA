"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Image as ImageIcon,
  Video,
  Film,
  Sparkles,
  Wallet,
  TrendingUp,
  Calendar,
} from "lucide-react";

type Stats = {
  ok: boolean;
  start: string;
  end: string;
  counts: {
    image: number;
    ugc: number;
    cinema: number;
    auto: number;
    clone: number;
    total: number;
  };
  total_cost: number;
  daily: { date: string; count: number }[];
};

// Dashboard landing — replaces the "Url to Ad coming soon" placeholder.
// Default range: 1st of current month → today. The user can adjust the date
// pickers; the API recomputes on each apply. All counts come from history
// rows in `done` state.
export default function DashboardOverview({ name }: { name: string }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [start, setStart] = useState(fmt(monthStart));
  const [end, setEnd] = useState(fmt(today));
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(s: string, e: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/dashboard/stats?start=${s}&end=${e}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (j?.ok) setStats(j);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilter() {
    void load(start, end);
  }

  function resetFilter() {
    const s = fmt(monthStart);
    const e = fmt(today);
    setStart(s);
    setEnd(e);
    void load(s, e);
  }

  // Chart scaling — peak count drives bar height
  const chartMax = useMemo(() => {
    const m = Math.max(1, ...(stats?.daily || []).map((d) => d.count));
    return m;
  }, [stats]);

  return (
    <div className="px-5 lg:px-10 pt-8 pb-12 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--color-orange)" }} />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
            style={{ color: "var(--color-orange)" }}
          >
            Dashboard
          </span>
        </div>
        <h1 className="font-display font-extrabold text-3xl tracking-tight leading-none text-[var(--color-text-primary)]">
          Welcome back{name ? `, ${name}` : ""}
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-2">
          Production summary for the selected date range.
        </p>
      </div>

      {/* Stat cards row — 4 type counts + total cost */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard
          label="Image"
          value={loading ? "—" : String(stats?.counts.image ?? 0)}
          accent="#ff6a1a"
          icon={<ImageIcon className="w-4 h-4" />}
        />
        <StatCard
          label="UGC"
          value={loading ? "—" : String(stats?.counts.ugc ?? 0)}
          accent="#22c55e"
          icon={<Video className="w-4 h-4" />}
        />
        <StatCard
          label="Cinema"
          value={loading ? "—" : String(stats?.counts.cinema ?? 0)}
          accent="#7c4dff"
          icon={<Film className="w-4 h-4" />}
        />
        <StatCard
          label="Auto Content"
          value={loading ? "—" : String(stats?.counts.auto ?? 0)}
          accent="#f59e0b"
          icon={<Sparkles className="w-4 h-4" />}
        />
        <StatCard
          label="Total Cost"
          value={
            loading
              ? "—"
              : `RM ${(stats?.total_cost ?? 0).toFixed(2)}`
          }
          accent="#ef4444"
          icon={<Wallet className="w-4 h-4" />}
          wide
        />
      </div>

      {/* Filter card */}
      <div
        className="rounded-2xl p-5 mb-5"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4" style={{ color: "var(--color-orange)" }} />
          <h2 className="font-display font-extrabold text-sm uppercase tracking-wider text-[var(--color-text-primary)]">
            Filter by Date Range
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5 text-[var(--color-text-secondary)]">
              From Date
            </label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs font-semibold outline-none"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5 text-[var(--color-text-secondary)]">
              To Date
            </label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs font-semibold outline-none"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={applyFilter}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50 transition-transform hover:-translate-y-0.5"
              style={{
                background:
                  "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
                boxShadow: "0 4px 14px rgba(255,77,0,0.3)",
              }}
            >
              Apply
            </button>
            <button
              onClick={resetFilter}
              className="px-4 py-2 rounded-lg text-xs font-bold"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Daily trend chart */}
      <div
        className="rounded-2xl p-5"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp
              className="w-4 h-4"
              style={{ color: "var(--color-orange)" }}
            />
            <h2 className="font-display font-extrabold text-sm uppercase tracking-wider text-[var(--color-text-primary)]">
              Daily Production
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
            {stats ? `${stats.counts.total} total in range` : "—"}
          </span>
        </div>

        {loading || !stats ? (
          <div className="text-xs text-[var(--color-text-muted)] py-12 text-center">
            Loading…
          </div>
        ) : stats.daily.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)] py-12 text-center">
            No production in this range.
          </div>
        ) : (
          <div className="flex items-end gap-1 h-44 overflow-x-auto pb-2">
            {stats.daily.map((d) => {
              const heightPct = (d.count / chartMax) * 100;
              return (
                <div
                  key={d.date}
                  className="flex flex-col items-center gap-1 min-w-[26px] flex-1"
                  title={`${d.date}: ${d.count}`}
                >
                  <div
                    className="w-full rounded-t flex items-end justify-center"
                    style={{
                      height: `${Math.max(heightPct, d.count > 0 ? 6 : 1)}%`,
                      background:
                        d.count > 0
                          ? "linear-gradient(180deg, #ff6a1a 0%, #ff4d00 100%)"
                          : "rgba(255,255,255,0.05)",
                      transition: "height 0.4s ease",
                    }}
                  >
                    {d.count > 0 && heightPct > 25 && (
                      <span className="text-[8px] font-bold text-white pb-0.5">
                        {d.count}
                      </span>
                    )}
                  </div>
                  <span className="text-[8px] font-mono text-[var(--color-text-muted)] whitespace-nowrap">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
  wide,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 ${wide ? "col-span-2 lg:col-span-1" : ""}`}
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
          {label}
        </span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: `${accent}1a`,
            color: accent,
          }}
        >
          {icon}
        </div>
      </div>
      <div
        className="font-display font-extrabold text-2xl tracking-tight"
        style={{ color: "var(--color-text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}
