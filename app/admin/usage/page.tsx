"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users as UsersIcon,
  Activity,
  DollarSign,
  TrendingUp,
  Search,
  Loader2,
  Calendar,
} from "lucide-react";

type UsageRow = {
  id: string;
  user_id: string;
  email: string;
  reason: string;
  amount: number;
  created_at: string;
};

type SummaryRow = {
  user_id: string;
  email: string;
  requests: number;
  total: number;
  models: string[];
};

export default function AdminUsage() {
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [start, setStart] = useState(monthStart.toISOString().slice(0, 10));
  const [end, setEnd] = useState(today.toISOString().slice(0, 10));
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/usage?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      setRows(d?.rows || []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Only image + video count for usage stats (auto_plan / clone_plan / signup_bonus excluded)
  const generationRows = useMemo(
    () =>
      filtered.filter(
        (r) =>
          r.reason.startsWith("image") || r.reason.startsWith("video")
      ),
    [filtered]
  );

  const summary = useMemo<SummaryRow[]>(() => {
    const map = new Map<string, SummaryRow>();
    for (const r of generationRows) {
      const cost = Math.abs(Number(r.amount || 0));
      const existing = map.get(r.user_id);
      if (existing) {
        existing.requests++;
        existing.total += cost;
        if (!existing.models.includes(r.reason)) existing.models.push(r.reason);
      } else {
        map.set(r.user_id, {
          user_id: r.user_id,
          email: r.email,
          requests: 1,
          total: cost,
          models: [r.reason],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [generationRows]);

  const stats = useMemo(() => {
    const totalUsers = summary.length;
    const totalRequests = generationRows.length;
    const totalUsage = generationRows.reduce(
      (acc, r) => acc + Math.abs(Number(r.amount || 0)),
      0
    );
    const avg = totalUsers ? totalUsage / totalUsers : 0;
    return { totalUsers, totalRequests, totalUsage, avg };
  }, [summary, generationRows]);

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full" style={{ background: "rgba(200,245,62,0.1)", border: "1px solid rgba(200,245,62,0.25)" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-lime)" }} />
          <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: "var(--color-lime)" }}>
            Live data
          </span>
        </div>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight text-[var(--color-text-primary)]">
          Usage Analytics
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1.5">
          Image + Video deductions only — auto plan, clone plan, signup bonuses excluded.
        </p>
      </div>

      {/* Stats — unified lime accent for all primary numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Users", value: stats.totalUsers, icon: UsersIcon, glow: "rgba(200,245,62,0.18)" },
          { label: "Total Requests", value: stats.totalRequests, icon: Activity, glow: "rgba(200,245,62,0.18)" },
          { label: "Total Usage", value: `RM${stats.totalUsage.toFixed(2)}`, icon: DollarSign, glow: "rgba(255,87,34,0.18)" },
          { label: "Avg per User", value: `RM${stats.avg.toFixed(2)}`, icon: TrendingUp, glow: "rgba(200,245,62,0.18)" },
        ].map((s, i) => {
          const Icon = s.icon;
          const isMoney = String(s.value).startsWith("RM");
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
                      background: isMoney ? "rgba(255,87,34,0.12)" : "rgba(200,245,62,0.12)",
                      border: `1px solid ${isMoney ? "rgba(255,87,34,0.3)" : "rgba(200,245,62,0.3)"}`,
                    }}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color: isMoney ? "var(--color-orange)" : "var(--color-lime)" }}
                      strokeWidth={2.4}
                    />
                  </div>
                </div>
                <div
                  className="font-display font-extrabold text-3xl md:text-4xl tracking-tight tabular-nums"
                  style={{ color: isMoney ? "var(--color-orange)" : "var(--color-lime)" }}
                >
                  {s.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters — dark inputs */}
      <div
        className="rounded-3xl p-5 mb-5 border"
        style={{ background: "var(--color-bg-card)", borderColor: "var(--color-border)" }}
      >
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Start Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="input pl-11"
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              End Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="input pl-11"
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
              <input
                placeholder="email or model…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-11"
              />
            </div>
          </div>
        </div>
      </div>

      {/* View toggle — lime active state */}
      <div
        className="flex gap-2 p-1.5 rounded-2xl w-fit mb-4 border"
        style={{ background: "var(--color-bg-card)", borderColor: "var(--color-border)" }}
      >
        {(
          [
            { k: "summary", label: "Summary by User" },
            { k: "detail", label: "Detail Log" },
          ] as { k: typeof view; label: string }[]
        ).map((t) => {
          const active = view === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setView(t.k)}
              className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all"
              style={
                active
                  ? { background: "var(--color-lime)", color: "#0a0a0a", boxShadow: "0 4px 14px rgba(200,245,62,0.3)" }
                  : { color: "var(--color-text-secondary)", background: "transparent" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div
        className="rounded-3xl overflow-hidden border"
        style={{ background: "var(--color-bg-card)", borderColor: "var(--color-border)" }}
      >
        {loading && (
          <div className="px-4 py-16 text-center">
            <Loader2 className="w-5 h-5 animate-spin inline" style={{ color: "var(--color-lime)" }} />
          </div>
        )}

        {!loading && view === "summary" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold border-b"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "rgba(200,245,62,0.04)",
                  }}
                >
                  <th className="text-left px-5 py-4 w-12">#</th>
                  <th className="text-left px-5 py-4">Email</th>
                  <th className="text-right px-5 py-4 w-28">Requests</th>
                  <th className="text-left px-5 py-4">Models Used</th>
                  <th className="text-right px-5 py-4 w-32">Total Usage</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-16 text-center text-[var(--color-text-muted)] text-sm"
                    >
                      Tiada usage dalam julat ini.
                    </td>
                  </tr>
                ) : (
                  summary.map((s, i) => (
                    <tr
                      key={s.user_id}
                      className="border-b last:border-b-0 transition-colors"
                      style={{ borderColor: "var(--color-border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(200,245,62,0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <td className="px-5 py-4 text-[var(--color-text-muted)] font-mono text-xs">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-5 py-4 font-semibold text-[var(--color-text-primary)]">
                        {s.email}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-[var(--color-text-primary)] tabular-nums">
                        {s.requests}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {s.models.map((m) => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                              style={{
                                background: "rgba(200,245,62,0.1)",
                                color: "var(--color-lime)",
                                border: "1px solid rgba(200,245,62,0.25)",
                              }}
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td
                        className="px-5 py-4 text-right font-extrabold tabular-nums"
                        style={{ color: "var(--color-orange)" }}
                      >
                        RM{s.total.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && view === "detail" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold border-b"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "rgba(200,245,62,0.04)",
                  }}
                >
                  <th className="text-left px-5 py-4 w-12">#</th>
                  <th className="text-left px-5 py-4">Date</th>
                  <th className="text-left px-5 py-4">Email</th>
                  <th className="text-left px-5 py-4">Action</th>
                  <th className="text-right px-5 py-4">Cost</th>
                </tr>
              </thead>
              <tbody>
                {generationRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-16 text-center text-[var(--color-text-muted)] text-sm"
                    >
                      Tiada usage log.
                    </td>
                  </tr>
                ) : (
                  generationRows.map((r, i) => (
                    <tr
                      key={r.id}
                      className="border-b last:border-b-0 transition-colors"
                      style={{ borderColor: "var(--color-border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(200,245,62,0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <td className="px-5 py-4 text-[var(--color-text-muted)] font-mono text-xs">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-5 py-4 text-[var(--color-text-secondary)] font-mono text-xs">
                        {new Date(r.created_at).toLocaleString("ms-MY", {
                          day: "2-digit",
                          month: "short",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-4 text-[var(--color-text-primary)]">{r.email}</td>
                      <td className="px-5 py-4">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                          style={{
                            background: "rgba(200,245,62,0.1)",
                            color: "var(--color-lime)",
                            border: "1px solid rgba(200,245,62,0.25)",
                          }}
                        >
                          {r.reason}
                        </span>
                      </td>
                      <td
                        className="px-5 py-4 text-right font-extrabold tabular-nums"
                        style={{ color: "var(--color-orange)" }}
                      >
                        RM{Math.abs(Number(r.amount)).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
