"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users as UsersIcon,
  Activity,
  DollarSign,
  TrendingUp,
  Search,
  Loader2,
  X,
  Copy,
  Check,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { localDateStr } from "@/lib/date-util";

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
  const [view, setView] = useState<"summary" | "detail">("detail");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptModal, setPromptModal] = useState<UsageRow | null>(null);
  const [previewModal, setPreviewModal] = useState<UsageRow | null>(null);

  // Malaysia-local dates (UTC+8) — default both to today, admin can
  // widen if they want. Avoid Date.toISOString here (off-by-one to UTC).
  const [start, setStart] = useState(localDateStr());
  const [end, setEnd] = useState(localDateStr());
  // Media filter — limit Detail Log + Summary to image-only or video-only
  // rows. "all" shows everything. Logic mirrors the cell isImg/isVid
  // detection so the filter agrees with what the rows render as.
  // Defaulted to "video" per admin direction: usage log is video-first
  // (admin can still flip to "Images" or "All" via the dropdown).
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "video">("video");
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
    // Search matches across every meaningful row identifier so admin can
    // type 'sora', 'auto', 'veo', 'p6', a framework name, or a prompt
    // fragment and have rows narrow correctly. Without metadata + tab +
    // type + prompt + provider matches, typing 'sora' returned 0 rows
    // even though the Sora 2 count chip showed 7 — search felt broken.
    return rows.filter((r) => {
      const meta = (r.metadata as any) || {};
      const haystack = [
        r.email,
        r.reason,
        r.tab,
        r.type,
        r.prompt,
        meta.modelChoice,
        meta.provider,
        meta.slot,
        meta.featureType,
        meta.framework,
        meta.ideaStyle,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  // Only image + video count for usage stats (auto_plan / clone_plan /
  // signup_bonus excluded). Then narrow further by mediaFilter so admin
  // can isolate just image-gen or just video-gen rows.
  //
  // INTERMEDIATE IMAGE EXCLUSION — per user direction, hide image rows
  // that are auxiliary steps within a larger generation:
  //   - fairytale-scene: per-scene image inside a Storytelling video
  //   - fairytale-hero: auto-generated main character ref for Storytelling
  //   - talking-object-image: source image for a Viral Talking Object video
  // The "main" output rows for those features (Storytelling merged video,
  // Talking Object talking video) still appear normally — only the
  // intermediate image steps are dropped from the admin Detail Log
  // so the log stays focused on user-facing outputs.
  const generationRows = useMemo(
    () => {
      const base = filtered.filter((r) => {
        // VIDEO-ONLY DETAIL LOG — per admin direction, exclude all
        // image rows from the usage log entirely. The breakdown +
        // table + counters all only consider video generations.
        if (!r.reason.startsWith("video")) {
          return false;
        }
        // Drop Storytelling intermediate image rows (per-scene + hero).
        if (r.type === "fairytale-scene" || r.type === "fairytale-hero") {
          return false;
        }
        // Drop Viral Talking Object source-image row (the still image
        // that gets animated into the Talking Object video).
        const featureType = String((r.metadata as any)?.featureType || "").toLowerCase();
        if (featureType === "talking-object-image") {
          return false;
        }
        // Drop raw image-tab rows (type='image') as a final safety net.
        if (r.type === "image") return false;
        return true;
      });
      // mediaFilter retained for backward compat but always evaluates
      // to "video" path now since all image rows are filtered out above.
      if (mediaFilter === "all") return base;
      return base.filter((r) => {
        const isImg =
          r.type === "image" ||
          r.type === "fairytale-scene" ||
          r.type === "fairytale-hero";
        if (mediaFilter === "image") return isImg;
        // mediaFilter === "video"
        return !isImg && (
          r.type === "video" ||
          r.type === "auto-content" ||
          r.type === "clone" ||
          r.tab === "cinema"
        );
      });
    },
    [filtered, mediaFilter]
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

  // Per-engine VIDEO breakdown — counts shown above the Detail Log so
  // admin sees at-a-glance how many of each engine generated in the
  // current date+media filter window. Classification mirrors the TAB
  // chip detection so the counts match the visible row tags:
  //   - Sora     : tab='sora2' OR metadata.modelChoice='sora2'
  //   - Story    : tab='fairytale' OR type='fairytale-*' (intermediate
  //                steps already excluded from generationRows, so this
  //                catches only the final merged video row)
  //   - Grok     : tab='cinema' OR metadata.modelChoice contains 'grok'
  //                OR metadata.provider='grok'
  //   - Veo      : everything else that's a video — UGC, Auto Content,
  //                Viral Talking Object all route through Veo
  // Image rows are excluded entirely from these counts (image breakdown
  // would be its own future card if needed).
  const videoBreakdown = useMemo(() => {
    let veo = 0;
    let grok = 0;
    let sora = 0;
    let seedance = 0;
    let story = 0;
    let image = 0;
    let gemini = 0;
    for (const r of generationRows) {
      const isImg =
        r.type === "image" ||
        r.type === "fairytale-scene" ||
        r.type === "fairytale-hero";
      if (isImg) {
        image++;
        continue;
      }
      const rawTab = String(r.tab || "").toLowerCase();
      const rawType = String(r.type || "").toLowerCase();
      const modelStr = String((r.metadata as any)?.model || "").toLowerCase();
      const modelChoice = String((r.metadata as any)?.modelChoice || "").toLowerCase();
      const provider = String((r.metadata as any)?.provider || "").toLowerCase();
      if (rawTab === "sora2" || modelChoice === "sora2" || modelStr.includes("sora")) {
        sora++;
      } else if (
        rawTab === "fairytale" ||
        rawType.startsWith("fairytale")
      ) {
        story++;
      } else if (
        rawTab === "seedance" ||
        modelStr.includes("seedance")
      ) {
        // Seedance rows — Cinema tab's Seedance feature + any
        // Auto Content batches that ever picked Seedance. Detect by
        // model substring to also catch legacy rows without the
        // modelChoice tag.
        seedance++;
      } else if (
        modelChoice === "grok" ||
        modelChoice.includes("grok") ||
        provider === "grok" ||
        modelStr.includes("grok")
      ) {
        // Grok detection by modelChoice/model/provider — works for both
        // Original Video (tab='original-video') and Viral (tab='cinema')
        // rows that picked Grok as the provider.
        grok++;
      } else if (
        modelChoice === "gemini" ||
        modelStr.includes("gemini-omni")
      ) {
        // GeminiOmni — covers Original Video tab Gemini rows AND
        // Auto Content Gemini rows. Detect by modelChoice tag stamped
        // at fire time, or by model substring for legacy rows.
        gemini++;
      } else if (
        modelChoice === "veo" ||
        rawTab === "video" ||
        rawTab === "auto" ||
        rawTab === "original-video" ||
        modelStr.includes("veo")
      ) {
        // Veo bucket — UGC tab + Auto Content + Original Video (Veo)
        // + Viral Talking Object (no modelChoice but always Veo).
        veo++;
      } else {
        // Catch-all (legacy rows without any tag we recognise) → Veo
        // bucket as the most common video family. Should be very rare
        // after the metadata stamping landed.
        veo++;
      }
    }
    return { veo, grok, sora, seedance, story, image, gemini };
  }, [generationRows]);

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

      {/* Stats — unified lime accent for all primary numbers.
          Per-user cards (Total Users + Avg per User) are hidden when
          viewing the Detail Log tab because that view is row-level
          (what was generated), not user-level (who generated it).
          Both per-user cards re-appear on Summary by User tab where
          they make sense as the summary header. */}
      <div className={`grid gap-4 mb-6 grid-cols-2 ${view === "detail" ? "md:grid-cols-2" : "md:grid-cols-4"}`}>
        {[
          { label: "Total Users", value: stats.totalUsers, icon: UsersIcon, glow: "rgba(200,245,62,0.18)", perUser: true },
          { label: "Total Requests", value: stats.totalRequests, icon: Activity, glow: "rgba(200,245,62,0.18)", perUser: false },
          { label: "Total Usage", value: `RM${stats.totalUsage.toFixed(2)}`, icon: DollarSign, glow: "rgba(255,87,34,0.18)", perUser: false },
          { label: "Avg per User", value: `RM${stats.avg.toFixed(2)}`, icon: TrendingUp, glow: "rgba(200,245,62,0.18)", perUser: true },
        ].filter((s) => (view === "detail" ? !s.perUser : true)).map((s, i) => {
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
                placeholder="email, tab, prompt, model…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-12"
              />
            </div>
          </div>
        </div>

        {/* Quick presets + media filter dropdown */}
        <div className="flex gap-2 mt-4 items-center flex-wrap">
          {[
            { label: "Today", days: 0 },
            { label: "Yesterday", days: -2 }, // sentinel: special handling below
            { label: "7d", days: 6 },
            { label: "Month", days: -1 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const today = localDateStr();
                if (p.days === -1) {
                  // Month-to-date — first of current month → today
                  const d = new Date();
                  setStart(localDateStr(new Date(d.getFullYear(), d.getMonth(), 1)));
                  setEnd(today);
                } else if (p.days === -2) {
                  // Yesterday — exactly one day in the past (start = end)
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  const y = localDateStr(d);
                  setStart(y);
                  setEnd(y);
                } else if (p.days === 0) {
                  // Today — single day
                  setStart(today);
                  setEnd(today);
                } else {
                  // N-days rolling window — N days ago → today
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

          {/* Media filter — narrow rows to images-only or videos-only.
              Sits next to the date presets so admin can stack filters
              (e.g. "Today + only Images" or "7d + only Videos"). */}
          <div className="ml-2 flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Media
            </span>
            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer outline-none"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="all">All</option>
              <option value="image">Images only</option>
              <option value="video">Videos only</option>
            </select>
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
            // Detail Log first — per admin workflow it's the more
            // frequently scanned view (per-row debugging, per-prompt
            // inspection). Summary stays available as the second toggle.
            { k: "detail", label: "Detail Log" },
            { k: "summary", label: "Summary by User" },
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
            <table className="w-full text-sm min-w-[640px]">
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
          <>
            {/* Per-engine VIDEO breakdown — counts of which engine generated
                in the current date+media filter window. Hidden when the
                media filter is "image" because the breakdown is video-only. */}
            {mediaFilter !== "image" && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                {[
                  { label: "Veo Videos", value: videoBreakdown.veo,   tone: "rgba(34,197,94,0.18)",  fg: "#16a34a", sub: "UGC + Auto + Original Video (Veo) + Viral" },
                  { label: "Grok Videos", value: videoBreakdown.grok, tone: "rgba(99,102,241,0.18)", fg: "#6366f1", sub: "Original Video (Grok) + legacy Cinema" },
                  { label: "Sora 2 Videos", value: videoBreakdown.sora, tone: "rgba(74,222,128,0.18)", fg: "#4ade80", sub: "Original Video (Sora 2) + Auto Content Sora 2" },
                  { label: "GeminiOmni", value: videoBreakdown.gemini, tone: "rgba(6,182,212,0.18)", fg: "#06b6d4", sub: "Original Video (Gemini) + Auto Content Gemini" },
                  { label: "Seedance", value: videoBreakdown.seedance, tone: "rgba(244,114,182,0.18)", fg: "#ec4899", sub: "Cinema Seedance + Auto Content Seedance" },
                  { label: "Storytelling", value: videoBreakdown.story, tone: "rgba(139,92,246,0.18)", fg: "#8b5cf6", sub: "Final merged story video" },
                ].map((b) => (
                  <div
                    key={b.label}
                    className="rounded-2xl px-5 py-4 border"
                    style={{
                      background: "rgba(255,255,255,0.015)",
                      borderColor: "var(--color-border)",
                      boxShadow: `inset 0 0 60px ${b.tone}`,
                    }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-widest font-bold text-[var(--color-text-muted)]">
                      {b.label}
                    </div>
                    <div
                      className="font-display font-extrabold text-3xl mt-1"
                      style={{ color: b.fg }}
                    >
                      {b.value}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                      {b.sub}
                    </div>
                  </div>
                ))}
              </div>
            )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
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
                  <th className="text-left px-5 py-4 w-48">Email</th>
                  <th className="text-left px-5 py-4 w-32">Action</th>
                  <th className="text-center px-5 py-4 w-20">Engine</th>
                  <th className="text-center px-5 py-4 w-24">Model</th>
                  <th className="text-center px-5 py-4 w-24">Tab</th>
                  <th className="text-left px-5 py-4 w-28">Framework</th>
                  <th className="text-left px-5 py-4 w-24">Idea</th>
                  <th className="text-left px-5 py-4">Prompt</th>
                  <th className="text-center px-5 py-4 w-24">Preview</th>
                  <th className="text-right px-5 py-4 w-24">Cost</th>
                </tr>
              </thead>
              <tbody>
                {generationRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-16 text-center text-[var(--color-text-muted)] text-sm"
                    >
                      Tiada usage log.
                    </td>
                  </tr>
                ) : (
                  generationRows.map((r, i) => {
                    // Image detection — includes 'image', 'fairytale-scene'
                    // (storytelling per-scene image), and 'fairytale-hero'
                    // (storytelling auto-generated main character image).
                    // Authoritative over tab tagging — Viral Talking Object
                    // inserts image rows tagged tab='cinema' that would
                    // otherwise fall into the video branch.
                    const isImg =
                      r.type === "image" ||
                      r.type === "fairytale-scene" ||
                      r.type === "fairytale-hero";
                    const isVid =
                      !isImg && (
                        r.type === "video" ||
                        r.type === "auto-content" ||
                        r.type === "clone" ||
                        r.tab === "cinema"
                      );
                    const promptShort = (r.prompt || "").trim().substring(0, 80);
                    // Linked history row was deleted (by user or admin) but
                    // the cost ledger entry remains. Mark visibly.
                    const historyDeleted =
                      !!r.history_id && !r.type && !r.tab && !r.prompt && !r.output_url;
                    // Which backend served this row. Prefer metadata.slot
                    // (e.g. "p6-a"/"p2-b") so the chip shows the exact key,
                    // fall back to metadata.provider ("p6"/"p2") for older
                    // rows without per-slot stamping.
                    const rawSlot = String(r.metadata?.slot || "");
                    const rawProvider = String(r.metadata?.provider || "");
                    const slotLabel = (rawSlot || rawProvider || "—")
                      .toUpperCase()
                      .replace(/^P2-([AB])$/, "P2 $1")
                      .replace(/^P6-([A-H])$/, "P6 $1");
                    const providerKey = (rawProvider ||
                      (rawSlot ? rawSlot.split("-")[0] : "")) as
                      | "p1" | "p2" | "p4" | "p5" | "p6" | "";
                    const providerStyle: Record<string, { bg: string; fg: string; bd: string; title: string }> = {
                      p1: { bg: "rgba(99,102,241,0.12)", fg: "#6366f1", bd: "rgba(99,102,241,0.3)", title: "GeminiGen" },
                      p2: { bg: "rgba(245,158,11,0.12)", fg: "#d97706", bd: "rgba(245,158,11,0.3)", title: "Crun.ai" },
                      p4: { bg: "rgba(236,72,153,0.12)", fg: "#ec4899", bd: "rgba(236,72,153,0.3)", title: "Grsai" },
                      p5: { bg: "rgba(14,165,233,0.12)", fg: "#0ea5e9", bd: "rgba(14,165,233,0.3)", title: "APIMart" },
                      p6: { bg: "rgba(168,85,247,0.12)", fg: "#a855f7", bd: "rgba(168,85,247,0.3)", title: "APIPod" },
                    };
                    const pStyle = providerStyle[providerKey] || {
                      bg: "rgba(120,120,120,0.12)", fg: "#999", bd: "rgba(120,120,120,0.3)", title: "Unknown",
                    };
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
                          {new Date(r.created_at).toLocaleString("en-GB", {
                            timeZone: "Asia/Kuala_Lumpur",
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </td>
                        <td className="px-5 py-4 text-[var(--color-text-secondary)] font-mono text-xs truncate" title={r.email}>
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
                            style={{
                              background: pStyle.bg,
                              color: pStyle.fg,
                              border: `1px solid ${pStyle.bd}`,
                            }}
                            title={pStyle.title}
                          >
                            {slotLabel}
                          </span>
                        </td>
                        {/* MODEL chip — classifies the actual generator
                            model family (Veo / Grok / Sora 2 / Seedance /
                            Image-gen). Detection chain mirrors the TAB
                            chip but reads from metadata.model +
                            metadata.modelChoice + reason so it works
                            regardless of which tab the row came from. */}
                        <td className="px-5 py-4 text-center">
                          {(() => {
                            const modelStr = String(r.metadata?.model || "").toLowerCase();
                            const modelChoice = String(r.metadata?.modelChoice || "").toLowerCase();
                            const rawTabM = String(r.tab || "").toLowerCase();
                            const reasonM = String(r.reason || "").toLowerCase();
                            const typeM = String(r.type || "").toLowerCase();

                            // Image-gen rows — short-circuit before video
                            // family detection so banana/imagen etc. don't
                            // misroute through the Veo bucket.
                            const isImageRow =
                              reasonM.startsWith("image") ||
                              typeM === "image" ||
                              typeM === "fairytale-scene" ||
                              typeM === "fairytale-hero";

                            type ModelStyle = { label: string; bg: string; fg: string; bd: string };
                            let style: ModelStyle | null = null;

                            if (isImageRow) {
                              // Sub-classify image model when known.
                              if (modelStr.includes("banana")) {
                                style = { label: "BANANA",   bg: "rgba(250,204,21,0.12)", fg: "#eab308", bd: "rgba(250,204,21,0.3)" };
                              } else if (modelStr.includes("imagen")) {
                                style = { label: "IMAGEN",   bg: "rgba(168,85,247,0.12)", fg: "#a855f7", bd: "rgba(168,85,247,0.3)" };
                              } else if (modelStr.includes("gpt-image")) {
                                style = { label: "GPT IMG",  bg: "rgba(56,189,248,0.12)", fg: "#0ea5e9", bd: "rgba(56,189,248,0.3)" };
                              } else {
                                style = { label: "IMAGE",    bg: "rgba(250,204,21,0.12)", fg: "#eab308", bd: "rgba(250,204,21,0.3)" };
                              }
                            } else if (
                              modelChoice === "sora2" ||
                              rawTabM === "sora2" ||
                              modelStr.includes("sora")
                            ) {
                              style = { label: "SORA 2",   bg: "rgba(74,222,128,0.12)",  fg: "#4ade80", bd: "rgba(74,222,128,0.4)" };
                            } else if (
                              modelChoice === "grok" ||
                              modelStr.includes("grok")
                            ) {
                              style = { label: "GROK",     bg: "rgba(99,102,241,0.12)",  fg: "#6366f1", bd: "rgba(99,102,241,0.3)" };
                            } else if (modelStr.includes("seedance")) {
                              style = { label: "SEEDANCE", bg: "rgba(244,114,182,0.12)", fg: "#ec4899", bd: "rgba(244,114,182,0.3)" };
                            } else if (modelStr.includes("veo")) {
                              style = { label: "VEO 3.1",  bg: "rgba(34,197,94,0.12)",   fg: "#16a34a", bd: "rgba(34,197,94,0.3)" };
                            }

                            if (!style) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  —
                                </span>
                              );
                            }
                            return (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                                style={{
                                  background: style.bg,
                                  color: style.fg,
                                  border: `1px solid ${style.bd}`,
                                }}
                                title={modelStr || style.label}
                              >
                                {style.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {(() => {
                            // Map history.tab + type values to a friendly label
                            // and a per-tab color. Falls back to "—" / grey
                            // when both fields are missing (orphan tx after
                            // user/admin deleted the history row).
                            const rawTab = String(r.tab || "").toLowerCase();
                            const rawType = String(r.type || "").toLowerCase();
                            const featureType = String(r.metadata?.featureType || "").toLowerCase();
                            const TAB_MAP: Record<string, { label: string; bg: string; fg: string; bd: string }> = {
                              video:     { label: "UGC",        bg: "rgba(34,197,94,0.12)",  fg: "#16a34a", bd: "rgba(34,197,94,0.3)" },
                              auto:      { label: "AUTO",       bg: "rgba(56,189,248,0.12)", fg: "#0ea5e9", bd: "rgba(56,189,248,0.3)" },
                              cinema:    { label: "CINEMA",     bg: "rgba(168,85,247,0.12)", fg: "#a855f7", bd: "rgba(168,85,247,0.3)" },
                              viral:     { label: "VIRAL",      bg: "rgba(239,68,68,0.12)",  fg: "#ef4444", bd: "rgba(239,68,68,0.3)" },
                              sora2:     { label: "SORA 2",     bg: "rgba(74,222,128,0.12)", fg: "#4ade80", bd: "rgba(74,222,128,0.4)" },
                              seedance:  { label: "SEEDANCE",   bg: "rgba(244,114,182,0.12)", fg: "#ec4899", bd: "rgba(244,114,182,0.3)" },
                              clone:     { label: "CLONE",      bg: "rgba(251,146,60,0.12)", fg: "#f97316", bd: "rgba(251,146,60,0.3)" },
                              image:     { label: "IMAGE",      bg: "rgba(250,204,21,0.12)", fg: "#eab308", bd: "rgba(250,204,21,0.3)" },
                              fairytale: { label: "STORY",      bg: "rgba(139,92,246,0.12)", fg: "#8b5cf6", bd: "rgba(139,92,246,0.3)" },
                              "original-video": { label: "ORIGINAL", bg: "rgba(250,204,21,0.12)", fg: "#facc15", bd: "rgba(250,204,21,0.35)" },
                            };
                            const TYPE_FALLBACK: Record<string, string> = {
                              "auto-content":      "auto",
                              "fairytale-scene":   "fairytale",
                              "fairytale-hero":    "fairytale",
                            };
                            // Source-of-truth ordering for the TAB chip:
                            //   1. metadata.featureType matches viral / talking-
                            //      object → VIRAL (catches the Talking Object
                            //      feature regardless of whether it inserted
                            //      tab='cinema' or any other tag).
                            //   2. tab='sora2' OR modelChoice='sora2' → SORA 2
                            //      (catches both standalone Sora 2 tab rows
                            //      AND Auto Content Sora 2 batches).
                            //   3. type='image' → IMAGE (raw image-gen rows)
                            //   4. raw tab if mapped
                            //   5. type-based fallback (auto-content → auto, etc.)
                            const isViral =
                              featureType.includes("talking-object") ||
                              featureType.includes("viral");
                            const modelChoiceLower = String(r.metadata?.modelChoice || "").toLowerCase();
                            const isSora2 =
                              rawTab === "sora2" ||
                              modelChoiceLower === "sora2";
                            const tabKey = isViral
                              ? "viral"
                              : isSora2
                                ? "sora2"
                                : rawType === "image"
                                  ? "image"
                                  : rawTab || TYPE_FALLBACK[rawType] || rawType;
                            const t = TAB_MAP[tabKey];
                            if (!t) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  —
                                </span>
                              );
                            }
                            return (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                                style={{
                                  background: t.bg,
                                  color: t.fg,
                                  border: `1px solid ${t.bd}`,
                                }}
                                title={`Generated from ${t.label} tab`}
                              >
                                {t.label}
                              </span>
                            );
                          })()}
                        </td>
                        {/* Framework — shown for Auto Content rows AND UGC
                            rows that used Idea mode (which now rotates a UGC
                            framework from Auto Content's pool). Dash for
                            anything else. */}
                        <td className="px-5 py-4">
                          {(() => {
                            const tabLower = String(r.tab || "").toLowerCase();
                            const typeLower = String(r.type || "").toLowerCase();
                            const isAuto = tabLower === "auto" || typeLower === "auto-content";
                            const isUgc = tabLower === "video" || typeLower === "video";
                            if (!isAuto && !isUgc) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  —
                                </span>
                              );
                            }
                            const fw = String(r.metadata?.framework || "").trim();
                            if (!fw) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  —
                                </span>
                              );
                            }
                            return (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold break-words line-clamp-6 max-w-full leading-snug"
                                style={{
                                  background: "rgba(244,114,182,0.1)",
                                  color: "#ec4899",
                                  border: "1px solid rgba(244,114,182,0.25)",
                                  wordBreak: "break-word",
                                }}
                                title={`Auto Content framework: ${fw}`}
                              >
                                {fw}
                              </span>
                            );
                          })()}
                        </td>
                        {/* Idea — Auto Content's optional Custom Idea style
                            tag (metadata.idea_style) AND UGC tab's new Idea
                            mode (metadata.expanded_from_idea=true). When
                            user used the legacy "Prompt" mode on either tab
                            this is empty → shows dash. Rainbow chip mirrors
                            the badge shown on the history card. */}
                        <td className="px-5 py-4">
                          {(() => {
                            const tabLower = String(r.tab || "").toLowerCase();
                            const typeLower = String(r.type || "").toLowerCase();
                            const isAuto = tabLower === "auto" || typeLower === "auto-content";
                            const isUgc = tabLower === "video" || typeLower === "video";
                            if (!isAuto && !isUgc) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  —
                                </span>
                              );
                            }
                            const idea = String(r.metadata?.idea_style || "").trim();
                            if (!idea) {
                              return (
                                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                  normal
                                </span>
                              );
                            }
                            return (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold break-words line-clamp-6 max-w-full leading-snug"
                                style={{
                                  background:
                                    "linear-gradient(90deg, rgba(236,72,153,0.15), rgba(168,85,247,0.15), rgba(56,189,248,0.15))",
                                  color: "#a855f7",
                                  border: "1px solid rgba(168,85,247,0.3)",
                                  wordBreak: "break-word",
                                }}
                                title={`Custom Idea: ${idea}`}
                              >
                                {idea}
                              </span>
                            );
                          })()}
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
                          ) : historyDeleted ? (
                            <span
                              className="text-[10px] font-mono italic"
                              style={{ color: "rgba(239,68,68,0.7)" }}
                              title="The linked history row has been deleted but the cost ledger entry remains."
                            >
                              (history deleted)
                            </span>
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
          </>
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

  // Image detection — includes 'image', 'fairytale-scene', and
  // 'fairytale-hero' so storytelling image rows open in <img> preview
  // not <video>. Matches the table cell's isImg/isVid order.
  const isImg =
    row.type === "image" ||
    row.type === "fairytale-scene" ||
    row.type === "fairytale-hero";
  const isVid =
    !isImg && (
      row.type === "video" ||
      row.type === "auto-content" ||
      row.type === "clone" ||
      row.tab === "cinema"
    );

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
