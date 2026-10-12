"use client";

// /admin/motion — Motion monitor. Every Motion job from every client in the
// date range (Malaysia days): running (stage + time so far, stuck flag), done
// and failed, with what the pipeline did — AI plan, guideline check, render.
// /admin/usage only lists credit deductions; this shows the jobs themselves.

import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Loader2, RefreshCcw, Search, ExternalLink } from "lucide-react";
import { localDateStr } from "@/lib/date-util";
import { MOTION_STAGE_LABEL } from "@/app/dashboard/sections/motion-progress";
import { motionStyle } from "@/lib/motion-styles";
import type { MotionGuardSummary } from "@/lib/motion-guard-summary";

type MotionRow = {
  id: string;
  email: string;
  created_at: string;
  updated_at: string | null;
  status: "pending" | "done" | "failed" | string;
  stage: string | null;
  account: string | null;
  error: string | null;
  mode: "edit" | "ad";
  cost: number | null;
  reserved: number | null;
  duration: number | null;
  style: string | null;
  language: string | null;
  guardOn: boolean;
  uploads: number;
  product: string | null;
  plan: { sec: number | null; overlays: number | null; broll: number | null; zooms: number | null; fixes: number | null; brand: string | null } | null;
  fallback: boolean;
  renderSec: number | null;
  guard: MotionGuardSummary | null;
  output: string | null;
  poster: string | null;
};

const STUCK_MIN = 40;

function formatMY(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso)).replace(",", " ·");
}
const minsSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const rm = (v: number | null) => (v === null ? "—" : `RM${v.toFixed(2)}`);

function Card({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--color-bg-card)", border: `1px solid ${tone}` }}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">{label}</div>
      <div className="text-2xl font-extrabold mt-1 text-[var(--color-text-primary)]">{value}</div>
      {sub && <div className="text-[10px] mt-0.5 text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

export default function AdminMotionPage() {
  // default range: the last 7 Malaysia days
  const [start, setStart] = useState(() => localDateStr(new Date(new Date().getTime() - 6 * 86_400_000)));
  const [end, setEnd] = useState(() => localDateStr());
  const [rows, setRows] = useState<MotionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "done" | "failed">("all");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/motion?start=${start}&end=${end}`, { cache: "no-store" });
      const d = await r.json();
      setRows(Array.isArray(d?.rows) ? d.rows : []);
    } finally {
      setLoading(false);
    }
  }
  // (re)load when the range changes — fetch-on-change is the point of this effect
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [start, end]);
  // keep running jobs fresh
  const running = rows.some((r) => r.status === "pending");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [running, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status === status) && (!q || r.email.toLowerCase().includes(q) || r.id.includes(q)));
  }, [rows, search, status]);

  const stats = useMemo(() => {
    const done = rows.filter((r) => r.status === "done");
    const renders = done.map((r) => r.renderSec).filter((v): v is number => v !== null);
    return {
      total: rows.length,
      done: done.length,
      failed: rows.filter((r) => r.status === "failed").length,
      running: rows.filter((r) => r.status === "pending").length,
      stuck: rows.filter((r) => r.status === "pending" && minsSince(r.created_at) > STUCK_MIN).length,
      charged: done.reduce((s, r) => s + (r.cost ?? 0), 0),
      avgRender: renders.length ? Math.round(renders.reduce((a, b) => a + b, 0) / renders.length / 60 * 10) / 10 : null,
      fallback: done.filter((r) => r.fallback).length,
      clients: new Set(rows.map((r) => r.email)).size,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(167,139,250,0.14)", border: "1px solid rgba(167,139,250,0.4)" }}>
          <Clapperboard className="w-6 h-6" style={{ color: "#a78bfa" }} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--color-text-primary)]">Motion Monitor</h1>
          <p className="text-xs text-[var(--color-text-secondary)]">Semua job Motion (semua klien) — sedang jalan, siap & gagal.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="input !py-1.5 text-xs" />
          <span className="text-xs text-[var(--color-text-muted)]">→</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="input !py-1.5 text-xs" />
          <button onClick={() => { const t = localDateStr(); setStart(t); setEnd(t); }} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>Hari ni</button>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card label="Job" value={stats.total} sub={`${stats.clients} klien`} tone="var(--color-border)" />
        <Card label="Siap" value={stats.done} tone="rgba(34,197,94,0.4)" />
        <Card label="Gagal" value={stats.failed} tone="rgba(239,68,68,0.4)" />
        <Card label="Sedang jalan" value={stats.running} sub={stats.stuck ? `${stats.stuck} tersekat > ${STUCK_MIN} min` : undefined} tone="rgba(245,158,11,0.4)" />
        <Card label="Caj (siap)" value={`RM${stats.charged.toFixed(2)}`} tone="rgba(167,139,250,0.4)" />
        <Card label="Purata render" value={stats.avgRender === null ? "—" : `${stats.avgRender} min`} tone="var(--color-border)" />
        <Card label="Caption sahaja" value={stats.fallback} sub="AI plan gagal" tone={stats.fallback ? "rgba(239,68,68,0.4)" : "var(--color-border)"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari email / id" className="input !py-1.5 !pl-8 text-xs w-56" />
        </div>
        {(["all", "pending", "done", "failed"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ border: "1px solid var(--color-border)", background: status === s ? "rgba(167,139,250,0.18)" : "transparent", color: "var(--color-text-primary)" }}>
            {{ all: "Semua", pending: "Sedang jalan", done: "Siap", failed: "Gagal" }[s]}
          </button>
        ))}
        <span className="text-xs text-[var(--color-text-muted)] ml-auto">{shown.length} job</span>
      </div>

      <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--color-border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)]" style={{ background: "var(--color-bg-card)" }}>
              {["Masa", "Klien", "Mod", "Status", "Video", "Caj", "Gaya", "AI plan", "Guideline", "Render", "Akaun", "Output"].map((h) => (
                <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const age = minsSince(r.created_at);
              const stuck = r.status === "pending" && age > STUCK_MIN;
              const look = r.style ? motionStyle(r.style) : null;
              const g = r.guard;
              const guardBits = g ? [
                g.tapedTexts.length ? `${g.tapedTexts.length} tulisan ditampal` : g.taped ? `${g.taped} ditampal` : "",
                g.cut ? `${g.cut} perkataan dipotong` : "",
                g.mutedWords.length || g.muted ? `${g.mutedWords.length || g.muted} di-mute` : "",
              ].filter(Boolean) : [];
              return (
                <tr key={r.id} className="align-top border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--color-text-secondary)]">{formatMY(r.created_at)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{r.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.mode === "ad" ? "Buat Iklan" : "Edit Video"}{r.uploads ? <span className="block text-[10px] text-[var(--color-text-muted)]">{r.uploads} gambar produk</span> : null}</td>
                  <td className="px-3 py-2 min-w-[150px]">
                    {r.status === "done" && <span className="font-bold text-green-500">Siap</span>}
                    {r.status === "failed" && <span className="font-bold text-red-400">Gagal</span>}
                    {r.status === "pending" && (
                      <span className="font-bold" style={{ color: stuck ? "#f87171" : "#f59e0b" }}>
                        {MOTION_STAGE_LABEL[String(r.stage || "queued")] || r.stage || "Dalam giliran"} · {age} min{stuck ? " · tersekat?" : ""}
                      </span>
                    )}
                    {r.error && <span className="block text-[10px] text-red-400 line-clamp-2" title={r.error}>{r.error}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.duration === null ? "—" : `${Math.round(r.duration)}s`}{r.language ? <span className="block text-[10px] text-[var(--color-text-muted)]">{r.language.toUpperCase()}</span> : null}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.status === "done" ? rm(r.cost) : r.status === "failed" ? "dipulangkan" : <span className="text-[var(--color-text-muted)]">tahan {rm(r.reserved)}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{look ? `${look.emoji} ${look.label}` : "—"}</td>
                  <td className="px-3 py-2 min-w-[150px]">
                    {r.fallback ? <span className="font-bold text-red-400">Caption sahaja (plan gagal)</span>
                      : r.plan ? (
                        <span className="text-[var(--color-text-secondary)]">
                          {r.plan.sec !== null ? `${r.plan.sec}s · ` : ""}{r.plan.overlays ?? 0} sticker · {r.plan.broll ?? 0} B-roll{r.plan.zooms !== null ? ` · ${r.plan.zooms} zoom` : ""}
                          {r.plan.fixes ? <span className="block text-[10px]">{r.plan.fixes} caption dibetulkan</span> : null}
                        </span>
                      ) : <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2 min-w-[140px]">
                    {!r.guardOn ? <span className="text-[var(--color-text-muted)]">tutup</span>
                      : guardBits.length ? <span className="text-[var(--color-text-secondary)]" title={g?.tapedTexts.join(", ")}>{guardBits.join(" · ")}</span>
                        : g ? <span className="text-green-500">bersih</span> : <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.renderSec === null ? "—" : `${Math.round(r.renderSec / 6) / 10} min`}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--color-text-secondary)]">{r.account ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.output ? (
                      <a href={r.output} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold" style={{ color: "#a78bfa" }}>
                        {r.poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.poster} alt="" className="w-8 h-12 object-cover rounded" />
                        )}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--color-text-muted)]">{loading ? "Memuatkan…" : "Tiada job Motion dalam julat ini."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
