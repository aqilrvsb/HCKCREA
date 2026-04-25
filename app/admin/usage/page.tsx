"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users as UsersIcon,
  Activity,
  DollarSign,
  TrendingUp,
  Search,
  Loader2,
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
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          Usage Analytics
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Image + Video deductions only (auto plan, clone plan, and signup
          bonuses excluded).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Total Users",
            value: stats.totalUsers,
            icon: UsersIcon,
            color: "text-blue-600",
          },
          {
            label: "Total Requests",
            value: stats.totalRequests,
            icon: Activity,
            color: "text-violet-600",
          },
          {
            label: "Total Usage",
            value: `RM${stats.totalUsage.toFixed(2)}`,
            icon: DollarSign,
            color: "text-orange",
          },
          {
            label: "Avg per User",
            value: `RM${stats.avg.toFixed(2)}`,
            icon: TrendingUp,
            color: "text-emerald-600",
          },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
                  {s.label}
                </span>
                <Icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div
                className={`font-display font-extrabold text-3xl tracking-tight ${s.color}`}
              >
                {s.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card p-5 mb-5">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              End Date
            </label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
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

      {/* View toggle */}
      <div className="flex gap-2 p-1.5 bg-white border border-[var(--color-border)] rounded-2xl shadow-sm w-fit mb-4">
        {(
          [
            { k: "summary", label: "Summary by User" },
            { k: "detail", label: "Detail Log" },
          ] as { k: typeof view; label: string }[]
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setView(t.k)}
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition ${
              view === t.k
                ? "bg-orange-50 text-orange"
                : "text-[var(--color-text-secondary)] hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading && (
          <div className="px-4 py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin inline text-orange" />
          </div>
        )}

        {!loading && view === "summary" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold border-b border-[var(--color-border)] bg-gray-50/50">
                  <th className="text-left px-4 py-3 w-10">No</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-right px-4 py-3 w-24">Requests</th>
                  <th className="text-left px-4 py-3">Models Used</th>
                  <th className="text-right px-4 py-3 w-28">Total Usage</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[var(--color-text-muted)]">
                      Tiada usage dalam julat ini.
                    </td>
                  </tr>
                ) : (
                  summary.map((s, i) => (
                    <tr
                      key={s.user_id}
                      className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-gray-50/40"
                    >
                      <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">{i + 1}</td>
                      <td className="px-4 py-3 font-semibold">{s.email}</td>
                      <td className="px-4 py-3 text-right font-bold">{s.requests}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.models.map((m) => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded text-[10px] font-mono bg-orange-50 text-orange border border-orange-100 font-bold"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-orange">
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
                <tr className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold border-b border-[var(--color-border)] bg-gray-50/50">
                  <th className="text-left px-4 py-3 w-10">No</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-right px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {generationRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[var(--color-text-muted)]">
                      Tiada usage log.
                    </td>
                  </tr>
                ) : (
                  generationRows.map((r, i) => (
                    <tr key={r.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-gray-50/40">
                      <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">{i + 1}</td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)] font-mono text-xs">
                        {new Date(r.created_at).toLocaleString("ms-MY", {
                          day: "2-digit", month: "short", year: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">{r.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-orange-50 text-orange border border-orange-100 font-bold">
                          {r.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-orange">
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
