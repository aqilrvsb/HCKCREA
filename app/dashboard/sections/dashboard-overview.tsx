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
  daily: {
    date: string;
    count: number;
    image: number;
    ugc: number;
    cinema: number;
    auto: number;
  }[];
};

// Series colours match the stat-card accents up top
const SERIES = [
  { key: "image" as const, label: "Image", color: "#facc15" },
  { key: "ugc" as const, label: "UGC", color: "#22c55e" },
  { key: "cinema" as const, label: "Cinema", color: "#7c4dff" },
  { key: "auto" as const, label: "Auto Content", color: "#f59e0b" },
];

// Dashboard landing — replaces the "Url to Ad coming soon" placeholder.
// Default range: 1st of current month → today. The user can adjust the date
// pickers; the API recomputes on each apply. All counts come from history
// rows in `done` state.
export default function DashboardOverview({ name }: { name: string }) {
  // fmt uses local getters, not toISOString(). On UTC+8 (Malaysia),
  // toISOString() of "April 1 00:00 local" = "March 31 16:00 UTC" → "2026-03-31"
  // which is wrong. Local getters give the user's actual date.
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // Initial values are empty strings to avoid SSR/CSR timezone-skew
  // hydration mismatch (server is UTC, client is the user's timezone — at
  // certain hours the day boundary differs and React #418 fires). The
  // useEffect below populates them on mount, before the user can interact.
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    setStart(fmt(monthStart));
    setEnd(fmt(today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const s = fmt(monthStart);
    const e = fmt(today);
    setStart(s);
    setEnd(e);
    void load(s, e);
  }

  // Toggle individual series on/off
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  // Chart scaling — peak across all visible series drives Y axis
  const chartMax = useMemo(() => {
    const days = stats?.daily || [];
    if (days.length === 0) return 1;
    let m = 1;
    for (const d of days) {
      for (const s of SERIES) {
        if (hidden[s.key]) continue;
        if (d[s.key] > m) m = d[s.key];
      }
    }
    return m;
  }, [stats, hidden]);

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
          accent="#facc15"
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
                  "linear-gradient(135deg, #facc15 0%, #eab308 100%)",
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
          <>
            {/* Series legend — clickable to toggle visibility */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              {SERIES.map((s) => {
                const isHidden = hidden[s.key];
                const total = (stats.daily || []).reduce(
                  (a, d) => a + d[s.key],
                  0
                );
                return (
                  <button
                    key={s.key}
                    onClick={() =>
                      setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))
                    }
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md transition-opacity"
                    style={{
                      opacity: isHidden ? 0.35 : 1,
                      background: isHidden
                        ? "transparent"
                        : "rgba(255,255,255,0.03)",
                    }}
                    title={`${s.label}: ${total} total · click to ${isHidden ? "show" : "hide"}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      {s.label}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                      {total}
                    </span>
                  </button>
                );
              })}
            </div>

            <MultiLineChart
              daily={stats.daily}
              max={chartMax}
              hidden={hidden}
            />
          </>
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

// ── Multi-line SVG chart ────────────────────────────────────────────────
//
// 4 series (Image / UGC / Cinema / Auto Content) plotted over the date range.
// Pure SVG, no chart lib — keeps bundle small + theme tokens flow naturally.
// Hover anywhere on the plot area to see the snap-tooltip with all 4 values
// at the closest date.

function MultiLineChart({
  daily,
  max,
  hidden,
}: {
  daily: Stats["daily"];
  max: number;
  hidden: Record<string, boolean>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 1000; // viewBox width — scales to container via CSS
  const H = 240;
  const PAD_L = 32;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 36;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = daily.length;

  // Y-tick values — 5 evenly spaced ticks (0 → max), rounded up to nice int
  const niceMax = max <= 1 ? 1 : Math.ceil(max);
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((niceMax * i) / 4));

  // X position for index i; snap-rendering uses these
  const xAt = (i: number) =>
    n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW;
  const yAt = (v: number) => PAD_T + plotH - (v / niceMax) * plotH;

  // Build path string for one series — line from point to point
  function pathFor(seriesKey: "image" | "ugc" | "cinema" | "auto") {
    if (n === 0) return "";
    const points = daily.map((d, i) => `${xAt(i)},${yAt(d[seriesKey])}`);
    return "M " + points.join(" L ");
  }

  // Show fewer x-axis labels when range is large (every Nth date)
  const labelStride = Math.max(1, Math.ceil(n / 14));

  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: `${W} / ${H}`, maxHeight: 280 }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        style={{ overflow: "visible" }}
      >
        {/* Grid lines + Y labels */}
        {yTicks.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-text-muted)"
                fontFamily="var(--font-geist-mono, monospace)"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* X-axis labels (date) */}
        {daily.map((d, i) => {
          if (i % labelStride !== 0 && i !== n - 1) return null;
          return (
            <text
              key={d.date}
              x={xAt(i)}
              y={H - PAD_B + 16}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-geist-mono, monospace)"
            >
              {d.date.slice(5)}
            </text>
          );
        })}

        {/* Series lines */}
        {SERIES.map((s) => {
          if (hidden[s.key]) return null;
          return (
            <g key={s.key}>
              <path
                d={pathFor(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Dots at every data point */}
              {daily.map((d, i) => (
                <circle
                  key={i}
                  cx={xAt(i)}
                  cy={yAt(d[s.key])}
                  r={hoverIdx === i ? 4 : 2.5}
                  fill={s.color}
                  stroke="var(--color-bg-card)"
                  strokeWidth={1}
                />
              ))}
            </g>
          );
        })}

        {/* Hover snap-line + invisible interaction band */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {/* Wide invisible bands for hover detection */}
        {daily.map((d, i) => {
          const bandW = plotW / Math.max(1, n - 1);
          const x = xAt(i) - bandW / 2;
          return (
            <rect
              key={i}
              x={x}
              y={PAD_T}
              width={bandW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}
      </svg>

      {/* Tooltip overlay */}
      {hoverIdx !== null && daily[hoverIdx] && (
        <div
          className="absolute pointer-events-none rounded-lg px-3 py-2 text-[10px] font-mono shadow-xl"
          style={{
            left: `${(xAt(hoverIdx) / W) * 100}%`,
            top: 0,
            transform:
              hoverIdx > n / 2 ? "translate(-105%, 0)" : "translate(5%, 0)",
            background: "rgba(20, 20, 24, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            minWidth: 140,
          }}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5 text-[var(--color-text-muted)]">
            {daily[hoverIdx].date}
          </div>
          {SERIES.map((s) => {
            if (hidden[s.key]) return null;
            return (
              <div
                key={s.key}
                className="flex items-center justify-between gap-3 py-0.5"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </span>
                <span className="font-bold tabular-nums">
                  {daily[hoverIdx][s.key]}
                </span>
              </div>
            );
          })}
          <div className="mt-1 pt-1 border-t border-white/10 flex items-center justify-between text-[10px] font-bold uppercase">
            <span>Total</span>
            <span className="tabular-nums">{daily[hoverIdx].count}</span>
          </div>
        </div>
      )}
    </div>
  );
}
