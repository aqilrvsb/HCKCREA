"use client";

// /admin/motion — Motion monitor. Every Motion job from every client in the
// date range (Malaysia days): running (stage + time so far, stuck flag), done
// and failed, with what the pipeline did — AI plan, guideline check, render.
// /admin/usage only lists credit deductions; this shows the jobs themselves.

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Loader2, RefreshCcw, Search, ExternalLink, Volume2, VolumeX, RotateCw, Trash2 } from "lucide-react";
import MotionResubmitDialog from "@/app/dashboard/sections/motion-resubmit-dialog";
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
  /** AI Auto job: style is the director's pick; angle = its selling angle. */
  auto?: boolean;
  angle?: string | null;
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
  /** Resubmit action: pre-fill + whether this job can be re-rendered. */
  productName?: string | null;
  productImages?: string[];
  canResubmit?: boolean;
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

type Peek = { src: string; poster: string | null; label: string; top: number; left: number; w: number; h: number };

/** Large 9:16 preview of a finished video, playing while the output thumbnail
 *  (or the preview itself) is hovered — one shared player, so sweeping the
 *  pointer down the column flips straight from video to video. Plays with
 *  sound (unless turned off). Browsers only allow sound after the viewer has
 *  clicked / pressed a key on the page once — until then it plays muted and
 *  says so, and the first click anywhere turns the sound on. */
function PeekVideo({ peek, sound, onSound, onEnter, onLeave }: {
  peek: Peek; sound: boolean; onSound: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const unlockedAt = useRef(0); // the click that unlocked sound mustn't also toggle it off
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !sound;
    v.play().then(() => setBlocked(false)).catch(() => {
      if (!sound) return;
      setBlocked(true);
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }, [peek.src, sound]);
  // sound blocked: the first click / key press on the page unlocks it
  useEffect(() => {
    if (!blocked) return;
    const unlock = () => {
      const v = ref.current;
      if (!v) return;
      unlockedAt.current = Date.now();
      v.muted = false;
      v.play().then(() => setBlocked(false)).catch(() => { v.muted = true; });
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [blocked]);
  return (
    <div className="fixed z-[300] rounded-2xl overflow-hidden"
      style={{ top: peek.top, left: peek.left, width: peek.w, height: peek.h, background: "#000", border: "1px solid rgba(167,139,250,0.55)", boxShadow: "0 18px 50px rgba(0,0,0,0.6)" }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <video ref={ref} src={peek.src} poster={peek.poster ?? undefined} playsInline loop preload="auto" className="w-full h-full object-contain" />
      <span className="absolute top-2 left-2 right-12 truncate text-[10px] font-bold text-white px-2 py-1 rounded-md" style={{ background: "rgba(0,0,0,0.55)" }}>{peek.label}</span>
      <button type="button" onClick={() => { if (Date.now() - unlockedAt.current > 800) onSound(); }} title={sound ? "Tutup bunyi" : "Buka bunyi"}
        className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: "rgba(0,0,0,0.6)" }}>
        {sound && !blocked ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>
      {sound && blocked && (
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold text-white px-3 py-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.7)" }}>
          🔇 Klik sekali untuk bunyi
        </span>
      )}
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

  // row actions: re-render (charged to the job's owner) / delete
  const [resubFor, setResubFor] = useState<MotionRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  async function deleteJob(r: MotionRow) {
    const running = r.status === "pending";
    if (!confirm(`Padam job Motion ${r.email} (${formatMY(r.created_at)})?${running ? "\nJob masih berjalan — kredit yang ditahan akan dipulangkan kepada klien." : ""}`)) return;
    setDeleting(r.id);
    try {
      const res = await fetch(`/api/history/delete?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert(d?.error || `Gagal padam (HTTP ${res.status})`); return; }
      setRows((cur) => cur.filter((x) => x.id !== r.id));
    } finally {
      setDeleting(null);
    }
  }

  // hover preview of the output video (desktop); the thumbnail still opens it in a new tab
  const [peek, setPeek] = useState<Peek | null>(null);
  const [sound, setSound] = useState(() => {
    // on unless this viewer turned it off
    try { return typeof window === "undefined" || localStorage.getItem("motion-monitor:sound") !== "0"; } catch { return true; }
  });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepPeek = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const hidePeek = () => { keepPeek(); hideTimer.current = setTimeout(() => setPeek(null), 150); };
  function showPeek(r: MotionRow, el: HTMLElement) {
    if (!r.output) return;
    keepPeek();
    const b = el.getBoundingClientRect();
    const h = Math.min(560, window.innerHeight - 24);
    const w = Math.round((h * 9) / 16);
    // left of the thumbnail (it sits in the last column); right of it if there's no room
    const left = b.left - w - 16 >= 8 ? b.left - w - 16 : Math.min(b.right + 16, window.innerWidth - w - 8);
    const top = Math.max(12, Math.min(b.top + b.height / 2 - h / 2, window.innerHeight - h - 12));
    setPeek({ src: r.output, poster: r.poster, label: `${r.email} · ${r.duration === null ? "" : `${Math.round(r.duration)}s`}`, top, left, w, h });
  }
  const toggleSound = () => setSound((s) => {
    try { localStorage.setItem("motion-monitor:sound", s ? "0" : "1"); } catch { /* storage blocked */ }
    return !s;
  });
  // a fixed preview would drift from its row on scroll — close it
  useEffect(() => {
    if (!peek) return;
    const close = () => setPeek(null);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [peek]);

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
              {["Masa", "Klien", "Mod", "Status", "Video", "Caj", "Gaya", "AI plan", "Guideline", "Render", "Akaun", "Output", "Tindakan"].map((h) => (
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
                    {r.status === "review" && <span className="font-bold" style={{ color: "#facc15" }}>📝 Menunggu semakan skrip</span>}
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.auto && <span className="text-[10px] font-bold mr-1" style={{ color: "#a78bfa" }} title="AI Auto — AI pilih gaya">🤖</span>}
                    {look ? `${look.emoji} ${look.label}` : r.auto ? "AI Auto" : "—"}
                    {r.angle && <span className="block text-[10px] text-[var(--color-text-muted)] max-w-[160px] truncate" title={r.angle}>{r.angle}</span>}
                  </td>
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
                      <a href={r.output} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold" style={{ color: "#a78bfa" }}
                        onMouseEnter={(e) => showPeek(r, e.currentTarget)} onMouseLeave={hidePeek}>
                        {r.poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.poster} alt="" className="w-8 h-12 object-cover rounded" />
                        )}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setResubFor(r)} disabled={!r.canResubmit}
                        title={r.canResubmit ? "Render semula (dicaj kepada klien)" : r.mode === "ad" ? "Buat Iklan tak boleh dihantar semula" : "Hanya job siap / gagal"}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white disabled:opacity-30"
                        style={{ background: "linear-gradient(135deg, #22c55e, #4ade80)" }}>
                        <RotateCw className="w-3.5 h-3.5" strokeWidth={2.4} />
                      </button>
                      <button type="button" onClick={() => void deleteJob(r)} disabled={deleting === r.id} title="Padam job"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, #ef4444, #f87171)" }}>
                        {deleting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={13} className="px-3 py-8 text-center text-[var(--color-text-muted)]">{loading ? "Memuatkan…" : "Tiada job Motion dalam julat ini."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {peek && <PeekVideo peek={peek} sound={sound} onSound={toggleSound} onEnter={keepPeek} onLeave={hidePeek} />}
      {resubFor && (
        <MotionResubmitDialog
          id={resubFor.id}
          product={resubFor.productName ?? undefined}
          images={resubFor.productImages}
          note={`Caj ditolak daripada kredit ${resubFor.email}.`}
          onClose={() => setResubFor(null)}
          onDone={() => { setResubFor(null); void load(); }}
        />
      )}
    </div>
  );
}
