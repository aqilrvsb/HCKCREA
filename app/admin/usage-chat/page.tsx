"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Users as UsersIcon,
  Search,
  Loader2,
  Zap,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { localDateStr } from "@/lib/date-util";

// /admin/usage-chat — Chat Model Usage tab. Mirrors /admin/usage's
// visual language but reads chat_usage instead of credit_transactions.
// Currently shows the model_custom_idea cascade only (three feature
// tags: ugc_custom_idea / auto_with_idea / auto_only).
//
// The headline metric is "fallback rate" — how often the main provider
// failed and the cascade had to walk past it. High fallback rate = time
// to swap the main provider in /admin/settings.

type ChatRow = {
  id: string;
  user_id: string | null;
  email: string;
  feature: "ugc_custom_idea" | "auto_with_idea" | "auto_only" | string;
  model_key: string;
  cascade_trace: Array<{
    provider: "openrouter" | "grsai";
    model: string;
    ok: boolean;
    error?: string;
    ms: number;
  }>;
  final_provider: string | null;
  final_model: string | null;
  succeeded: boolean;
  total_attempts: number;
  total_latency_ms: number | null;
  prompt_snippet: string | null;
  created_at: string;
};

const FEATURE_META: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  ugc_custom_idea: {
    label: "UGC Custom Idea",
    color: "#facc15",
    bg: "rgba(250,204,21,0.10)",
    border: "rgba(250,204,21,0.35)",
  },
  auto_with_idea: {
    label: "Auto + Idea",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.10)",
    border: "rgba(167,139,250,0.35)",
  },
  auto_only: {
    label: "Auto Only",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
    border: "rgba(96,165,250,0.35)",
  },
};

function providerStyle(p: string) {
  if (p === "grsai")
    return { bg: "rgba(34,197,94,0.12)", fg: "#16a34a", bd: "rgba(34,197,94,0.4)" };
  return { bg: "rgba(139,92,246,0.12)", fg: "#a78bfa", bd: "rgba(139,92,246,0.4)" };
}

export default function AdminUsageChat() {
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(localDateStr());
  const [end, setEnd] = useState(localDateStr());
  const [featureFilter, setFeatureFilter] = useState<
    "all" | "ugc_custom_idea" | "auto_with_idea" | "auto_only"
  >("all");
  const [search, setSearch] = useState("");
  const [traceModal, setTraceModal] = useState<ChatRow | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/usage-chat?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      setRows(d?.rows || []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let base = rows;
    if (featureFilter !== "all") {
      base = base.filter((r) => r.feature === featureFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => {
      const haystack = [
        r.email,
        r.feature,
        r.final_provider,
        r.final_model,
        r.model_key,
        r.prompt_snippet,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, featureFilter]);

  // Headline stats — total calls, unique users, fallback rate (how
  // often the cascade had to walk past the main slot), failure rate.
  const stats = useMemo(() => {
    const totalCalls = filtered.length;
    const uniqueUsers = new Set(filtered.map((r) => r.user_id || "anon")).size;
    const fellBack = filtered.filter((r) => r.total_attempts > 1).length;
    const failed = filtered.filter((r) => !r.succeeded).length;
    const fallbackRate = totalCalls ? (fellBack / totalCalls) * 100 : 0;
    const failureRate = totalCalls ? (failed / totalCalls) * 100 : 0;
    return { totalCalls, uniqueUsers, fallbackRate, failureRate };
  }, [filtered]);

  // Feature breakdown — per-bucket call count. Reads from unfiltered
  // `rows` so the breakdown chips always show the daily totals even
  // when the featureFilter narrows the table below.
  const featureBreakdown = useMemo(() => {
    const counts: Record<string, number> = {
      ugc_custom_idea: 0,
      auto_with_idea: 0,
      auto_only: 0,
    };
    for (const r of rows) {
      if (counts[r.feature] !== undefined) counts[r.feature]++;
    }
    return counts;
  }, [rows]);

  return (
    <div>
      <div className="mb-8">
        <div
          className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full"
          style={{
            background: "rgba(167,139,250,0.10)",
            border: "1px solid rgba(167,139,250,0.30)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "#a78bfa" }}
          />
          <span
            className="text-[10px] font-mono uppercase tracking-widest font-bold"
            style={{ color: "#a78bfa" }}
          >
            Chat cascade trace
          </span>
        </div>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight text-[var(--color-text-primary)]">
          Usage Chat
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1.5">
          Model Custom Idea cascade — UGC tab + Auto Content. See which
          fallback layer is getting hit per call.
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid gap-4 mb-6 grid-cols-2 md:grid-cols-4">
        {[
          {
            label: "Total Calls",
            value: stats.totalCalls,
            icon: Activity,
            glow: "rgba(167,139,250,0.18)",
            color: "#a78bfa",
          },
          {
            label: "Unique Users",
            value: stats.uniqueUsers,
            icon: UsersIcon,
            glow: "rgba(96,165,250,0.18)",
            color: "#60a5fa",
          },
          {
            label: "Fallback Rate",
            value: `${stats.fallbackRate.toFixed(1)}%`,
            icon: ChevronRight,
            glow: "rgba(250,204,21,0.18)",
            color: "#facc15",
          },
          {
            label: "Failure Rate",
            value: `${stats.failureRate.toFixed(1)}%`,
            icon: XCircle,
            glow: "rgba(239,68,68,0.18)",
            color: "#ef4444",
          },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={i}
              className="relative overflow-hidden rounded-3xl p-5 border transition-all hover:-translate-y-0.5"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-bg-card) 0%, rgba(22,22,22,0.6) 100%)",
                borderColor: "var(--color-border)",
              }}
            >
              <div
                className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none"
                style={{
                  background: `radial-gradient(circle, ${s.glow}, transparent 70%)`,
                  filter: "blur(20px)",
                }}
              />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
                    {s.label}
                  </span>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{
                      background: `${s.color}22`,
                      border: `1px solid ${s.color}55`,
                    }}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color: s.color }}
                      strokeWidth={2.4}
                    />
                  </div>
                </div>
                <div
                  className="font-display font-extrabold text-3xl md:text-4xl tracking-tight tabular-nums"
                  style={{ color: s.color }}
                >
                  {s.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature breakdown chips — also act as one-click filters */}
      <div className="grid gap-3 mb-6 grid-cols-1 md:grid-cols-3">
        {(["ugc_custom_idea", "auto_with_idea", "auto_only"] as const).map(
          (key) => {
            const meta = FEATURE_META[key];
            const active = featureFilter === key;
            return (
              <button
                key={key}
                onClick={() => setFeatureFilter(active ? "all" : key)}
                className="text-left rounded-2xl p-4 border transition-all hover:-translate-y-0.5"
                style={{
                  background: active ? meta.bg : "var(--color-bg-card)",
                  borderColor: active ? meta.border : "var(--color-border)",
                  boxShadow: active ? `0 4px 14px ${meta.bg}` : undefined,
                }}
              >
                <div
                  className="text-[10px] font-mono uppercase tracking-widest font-bold mb-1.5"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </div>
                <div
                  className="font-display font-extrabold text-3xl tabular-nums"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {featureBreakdown[key]}
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  {key === "ugc_custom_idea" &&
                    "Custom Idea button on the UGC tab"}
                  {key === "auto_with_idea" &&
                    "Auto Content batch with idea_style filled"}
                  {key === "auto_only" &&
                    "Auto Content batch with no custom idea"}
                </div>
              </button>
            );
          }
        )}
      </div>

      {/* Filters */}
      <div
        className="rounded-3xl p-5 mb-5 border"
        style={{
          background: "var(--color-bg-card)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Start Date (MYT)
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
              className="input"
              style={{ colorScheme: "dark" }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              End Date (MYT)
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
              className="input"
              style={{ colorScheme: "dark" }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none z-10" />
              <input
                placeholder="email, provider, model, prompt…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-12"
              />
            </div>
          </div>
        </div>

        {/* Quick date presets */}
        <div className="flex gap-2 mt-4 items-center flex-wrap">
          {[
            { label: "Today", days: 0 },
            { label: "Yesterday", days: -2 },
            { label: "7d", days: 6 },
            { label: "Month", days: -1 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const today = localDateStr();
                if (p.days === -1) {
                  const d = new Date();
                  setStart(
                    localDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
                  );
                  setEnd(today);
                } else if (p.days === -2) {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  const y = localDateStr(d);
                  setStart(y);
                  setEnd(y);
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
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-transform hover:-translate-y-0.5"
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
      </div>

      {/* Table */}
      <div
        className="rounded-3xl overflow-hidden border"
        style={{
          background: "var(--color-bg-card)",
          borderColor: "var(--color-border)",
        }}
      >
        {loading && (
          <div className="px-4 py-16 text-center">
            <Loader2
              className="w-5 h-5 animate-spin inline"
              style={{ color: "#a78bfa" }}
            />
          </div>
        )}
        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold border-b"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "rgba(167,139,250,0.05)",
                  }}
                >
                  <th className="text-left px-5 py-4 w-12">#</th>
                  <th className="text-left px-5 py-4 w-44">Time</th>
                  <th className="text-left px-5 py-4">Email</th>
                  <th className="text-left px-5 py-4 w-44">Feature</th>
                  <th className="text-left px-5 py-4 w-44">Final Model</th>
                  <th className="text-left px-5 py-4 w-40">Cascade</th>
                  <th className="text-right px-5 py-4 w-20">Attempts</th>
                  <th className="text-right px-5 py-4 w-20">Latency</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-16 text-center text-[var(--color-text-muted)] text-sm"
                    >
                      Tiada chat usage dalam julat ini.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => {
                    const meta =
                      FEATURE_META[r.feature] || {
                        label: r.feature,
                        color: "#a3a3a3",
                        bg: "rgba(163,163,163,0.10)",
                        border: "rgba(163,163,163,0.30)",
                      };
                    const fellBack = r.total_attempts > 1;
                    const pStyle = providerStyle(r.final_provider || "");
                    return (
                      <tr
                        key={r.id}
                        className="border-b last:border-b-0 transition-colors cursor-pointer"
                        style={{ borderColor: "var(--color-border)" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "rgba(167,139,250,0.04)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "")
                        }
                        onClick={() => setTraceModal(r)}
                      >
                        <td className="px-5 py-4 text-[var(--color-text-muted)] font-mono text-xs">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="px-5 py-4 text-[var(--color-text-secondary)] font-mono text-xs">
                          {new Date(r.created_at).toLocaleString("en-MY", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </td>
                        <td className="px-5 py-4 font-semibold text-[var(--color-text-primary)] text-xs">
                          {r.email}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className="inline-block px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider"
                            style={{
                              background: meta.bg,
                              color: meta.color,
                              border: `1px solid ${meta.border}`,
                            }}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {r.succeeded && r.final_model ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
                                style={{
                                  background: pStyle.bg,
                                  color: pStyle.fg,
                                  border: `1px solid ${pStyle.bd}`,
                                }}
                              >
                                {r.final_provider}
                              </span>
                              <span className="text-xs font-mono text-[var(--color-text-secondary)] truncate">
                                {r.final_model}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs font-mono text-red-400">
                              all failed
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <CascadeBadge
                            trace={r.cascade_trace}
                            succeeded={r.succeeded}
                          />
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-xs tabular-nums">
                          <span
                            className={
                              fellBack
                                ? "text-yellow-400 font-bold"
                                : "text-[var(--color-text-secondary)]"
                            }
                          >
                            {r.total_attempts}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-xs text-[var(--color-text-secondary)] tabular-nums">
                          {r.total_latency_ms != null
                            ? `${r.total_latency_ms}ms`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trace modal — full cascade detail on row click */}
      {traceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setTraceModal(null)}
        >
          <div
            className="rounded-3xl p-6 max-w-2xl w-full border max-h-[85vh] overflow-y-auto"
            style={{
              background: "var(--color-bg-card)",
              borderColor: "var(--color-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-1">
                  Cascade Trace
                </div>
                <h2 className="font-display font-bold text-xl">
                  {FEATURE_META[traceModal.feature]?.label || traceModal.feature}
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  {traceModal.email} ·{" "}
                  {new Date(traceModal.created_at).toLocaleString("en-MY")}
                </p>
              </div>
              <button
                onClick={() => setTraceModal(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 mb-4">
              {traceModal.cascade_trace.map((step, i) => {
                const ps = providerStyle(step.provider);
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl border"
                    style={{
                      background: step.ok
                        ? "rgba(34,197,94,0.06)"
                        : "rgba(239,68,68,0.06)",
                      borderColor: step.ok
                        ? "rgba(34,197,94,0.25)"
                        : "rgba(239,68,68,0.25)",
                    }}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {step.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
                          style={{
                            background: ps.bg,
                            color: ps.fg,
                            border: `1px solid ${ps.bd}`,
                          }}
                        >
                          {step.provider}
                        </span>
                        <span className="text-xs font-mono">{step.model}</span>
                        <span className="text-[10px] font-mono text-[var(--color-text-muted)] ml-auto">
                          {step.ms}ms
                        </span>
                      </div>
                      {step.error && (
                        <p className="text-xs text-red-400 mt-1 break-all">
                          {step.error}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {traceModal.prompt_snippet && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
                  Prompt Snippet (first 200 chars)
                </div>
                <pre
                  className="text-xs whitespace-pre-wrap p-3 rounded-xl border font-mono"
                  style={{
                    background: "var(--color-bg)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {traceModal.prompt_snippet}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline cascade badge — one dot per attempt, green for success, red
// for failure, yellow ring on the slot that succeeded. Lets admin scan
// the table column and immediately spot rows where the main provider
// failed and a fallback had to step in.
function CascadeBadge({
  trace,
  succeeded,
}: {
  trace: ChatRow["cascade_trace"];
  succeeded: boolean;
}) {
  if (!trace || trace.length === 0) {
    return <span className="text-[10px] text-[var(--color-text-muted)]">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {trace.map((step, i) => {
        const isWinner = succeeded && i === trace.length - 1;
        return (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            )}
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: step.ok ? "#22c55e" : "#ef4444",
                boxShadow: isWinner
                  ? "0 0 0 2px rgba(250,204,21,0.5)"
                  : undefined,
              }}
              title={`${step.provider}/${step.model} — ${
                step.ok ? "OK" : step.error || "failed"
              } (${step.ms}ms)`}
            />
          </div>
        );
      })}
    </div>
  );
}
