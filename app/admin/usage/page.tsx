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
  X,
  Copy,
  Check,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { localDateStr, startOfMonthLocal } from "@/lib/date-util";

type UsageRow = {
  id: string;
  user_id: string;
  email: string;
  reason: string;
  amount: number;
  created_at: string;
  history_id?: string | null;
  type?: string | null;
  tab?: string | null;
  prompt?: string | null;
  output_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  metadata?: any;
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
  const [promptModal, setPromptModal] = useState<UsageRow | null>(null);
  const [previewModal, setPreviewModal] = useState<UsageRow | null>(null);

  // Malaysia-local dates (UTC+8) — toISOString would off-by-one to UTC.
  const [start, setStart] = useState(startOfMonthLocal());
  const [end, setEnd] = useState(localDateStr());
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
                  <th className="text-left px-5 py-4 w-36">Date</th>
                  <th className="text-left px-5 py-4">Email</th>
                  <th className="text-left px-5 py-4 w-32">Action</th>
                  <th className="text-center px-5 py-4 w-20">Engine</th>
                  <th className="text-left px-5 py-4">Prompt</th>
                  <th className="text-center px-5 py-4 w-24">Preview</th>
                  <th className="text-right px-5 py-4 w-24">Cost</th>
                </tr>
              </thead>
              <tbody>
                {generationRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-16 text-center text-[var(--color-text-muted)] text-sm"
                    >
                      Tiada usage log.
                    </td>
                  </tr>
                ) : (
                  generationRows.map((r, i) => {
                    const isVid =
                      r.type === "video" ||
                      r.type === "auto-content" ||
                      r.type === "clone" ||
                      r.tab === "cinema";
                    const isImg = r.type === "image";
                    const promptShort = (r.prompt || "").trim().substring(0, 80);
                    // Which backend served this row. Stamped at create time
                    // on history.metadata.provider. Old rows without it
                    // default to p2 (Crun).
                    const provider: "p1" | "p2" =
                      r.metadata?.provider === "p1" ? "p1" : "p2";
                    return (
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
                        <td className="px-5 py-4 text-[var(--color-text-primary)] truncate max-w-[180px]">
                          {r.email}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                            style={{
                              background: "rgba(200,245,62,0.1)",
                              color: "var(--color-lime)",
                              border: "1px solid rgba(200,245,62,0.25)",
                            }}
                          >
                            {r.reason}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                            style={
                              provider === "p1"
                                ? {
                                    background: "rgba(99,102,241,0.12)",
                                    color: "#6366f1",
                                    border: "1px solid rgba(99,102,241,0.3)",
                                  }
                                : {
                                    background: "rgba(245,158,11,0.12)",
                                    color: "#d97706",
                                    border: "1px solid rgba(245,158,11,0.3)",
                                  }
                            }
                            title={provider === "p1" ? "GeminiGen.AI" : "Crun.ai"}
                          >
                            {provider}
                          </span>
                        </td>
                        <td className="px-5 py-4 max-w-[320px]">
                          {promptShort ? (
                            <button
                              onClick={() => setPromptModal(r)}
                              className="text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-lime)] line-clamp-2 transition-colors"
                              title="Click to view full prompt"
                            >
                              {promptShort}
                              {r.prompt && r.prompt.length > 80 ? "…" : ""}
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {r.output_url ? (
                            <button
                              onClick={() => setPreviewModal(r)}
                              title={isVid ? "Play video" : "Open image"}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-transform hover:scale-105"
                              style={{
                                background: "rgba(34,197,94,0.1)",
                                border: "1px solid rgba(34,197,94,0.3)",
                                color: "#22c55e",
                              }}
                            >
                              {isVid ? (
                                <VideoIcon className="w-3 h-3" strokeWidth={2.4} />
                              ) : (
                                <ImageIcon className="w-3 h-3" strokeWidth={2.4} />
                              )}
                              {isVid ? "Video" : "Image"}
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                        <td
                          className="px-5 py-4 text-right font-extrabold tabular-nums"
                          style={{ color: "var(--color-orange)" }}
                        >
                          RM{Math.abs(Number(r.amount)).toFixed(2)}
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

      {promptModal && (
        <PromptModal
          row={promptModal}
          onClose={() => setPromptModal(null)}
        />
      )}
      {previewModal && (
        <PreviewModal
          row={previewModal}
          onClose={() => setPreviewModal(null)}
        />
      )}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────
function PromptModal({
  row,
  onClose,
}: {
  row: UsageRow;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function copy() {
    if (!row.prompt) return;
    await navigator.clipboard.writeText(row.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-lime)",
          boxShadow: "0 20px 60px rgba(200,245,62,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="font-display font-extrabold text-lg"
              style={{ color: "var(--color-lime)" }}
            >
              Full Prompt
            </h2>
            <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {row.email} · {row.reason} · {new Date(row.created_at).toLocaleString()}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5"
          >
            <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <pre
            className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap rounded-lg p-4"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {row.prompt || "(no prompt stored)"}
          </pre>
        </div>
        <div
          className="px-5 pb-5 pt-3 border-t flex gap-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={copy}
            className="flex-1 py-2.5 rounded-lg font-extrabold text-sm transition-transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
            style={{
              background: "var(--color-lime)",
              color: "#0a0a0a",
              boxShadow: "0 4px 14px rgba(200,245,62,0.3)",
            }}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy Prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({
  row,
  onClose,
}: {
  row: UsageRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const isVid =
    row.type === "video" ||
    row.type === "auto-content" ||
    row.type === "clone" ||
    row.tab === "cinema";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
      <div
        className="max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {row.output_url ? (
          isVid ? (
            <video
              src={row.output_url}
              controls
              autoPlay
              playsInline
              className="max-w-[90vw] max-h-[90vh] rounded-2xl"
            />
          ) : (
            <img
              src={row.output_url}
              alt=""
              className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain"
            />
          )
        ) : (
          <div className="text-white text-sm">No preview available</div>
        )}
      </div>
    </div>
  );
}
