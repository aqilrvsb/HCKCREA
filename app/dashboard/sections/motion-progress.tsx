"use client";

// Live placeholder for a Motion job that is still running, shown inside its
// History card: stage + progress bar over a faded preview of the source
// (uploaded video for Edit Video, first product photo for Buat Iklan).
// One shared poller for every pending Motion card on the page — a single
// /api/motion/status call for all of them every 5 s (that route also settles
// finished rows); when a job leaves "pending" the grid is told to refresh so
// the card turns into the finished video straight away.

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { motionGuardSummary } from "@/lib/motion-guard-summary";

export const MOTION_STAGE_LABEL: Record<string, string> = {
  queued: "Dalam giliran",
  script: "AI tulis skrip & storyboard",
  voice: "Jana suara",
  align: "Selaraskan suara & teks",
  music: "Gubah muzik",
  images: "Potong gambar produk",
  download: "Muat turun video",
  transcribe: "Transkrip suara",
  guard: "Semak guideline TikTok",
  normalise: "Potong senyap & sediakan video",
  faces: "Kesan muka",
  plan: "AI director + cari gambar Google",
  assets: "Muat turun B-roll & emoji",
  qa: "AI semak hasil (QA)",
  render: "Render animasi (selari)",
  upload: "Upload video siap",
  done: "Siap",
  failed: "Gagal",
};

type Prog = { status: string; stage: string | null; pct: number | null };
const state = new Map<string, Prog>();
const listeners = new Map<string, Set<(p: Prog) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function tick() {
  timer = null;
  const ids = [...listeners.keys()].slice(0, 20);
  if (!ids.length) return;
  let finished = false;
  try {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      const r = await fetch(`/api/motion/status?ids=${ids.join(",")}`, { cache: "no-store" });
      const d = await r.json();
      for (const j of (d?.jobs || []) as { id: string; status: string; stage?: string | null; pct?: number | null }[]) {
        const p: Prog = { status: j.status, stage: j.stage ?? null, pct: j.pct ?? null };
        state.set(j.id, p);
        listeners.get(j.id)?.forEach((fn) => fn(p));
        if (j.status !== "pending") finished = true;
      }
    }
  } catch { /* next tick retries */ }
  if (finished) window.dispatchEvent(new CustomEvent("history:refresh"));
  if (listeners.size && !timer) timer = setTimeout(tick, 5000);
}

function watch(id: string, fn: (p: Prog) => void): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  if (!timer) timer = setTimeout(tick, 300);
  return () => {
    const s = listeners.get(id);
    s?.delete(fn);
    if (s && s.size === 0) listeners.delete(id);
  };
}

const PLANNING_PCT: Record<string, number> = { queued: 3, script: 8, voice: 18 };

const quoted = (items: string[], max: number) => {
  const shown = items.slice(0, max).map((t) => `"${t.length > 40 ? `${t.slice(0, 40)}…` : t}"`).join(", ");
  return items.length > max ? `${shown} +${items.length - max} lagi` : shown;
};

/** Finished Motion card: exactly what "Check Guideline TikTok" taped, cut and muted. */
export function MotionGuardNote({ guard }: { guard: unknown }) {
  const g = motionGuardSummary(guard);
  if (!g) return null;
  const rows: [string, string][] = [];
  if (g.tapedTexts.length) rows.push(["Tulisan ditampal", quoted(g.tapedTexts, 8)]);
  if (g.tapedImagesUnlisted) rows.push(["Gambar B-roll ditampal", `${g.tapedImagesUnlisted} gambar`]);
  if (g.cutText) rows.push(["Ayat claim dipotong", `"${g.cutText.length > 160 ? `${g.cutText.slice(0, 160)}…` : g.cutText}"`]);
  else if (g.cut) rows.push(["Ayat claim dipotong", `${g.cut} perkataan`]);
  if (g.mutedWords.length) rows.push(["Di-mute & ditutup dalam caption", quoted(g.mutedWords, 10)]);
  else if (g.muted) rows.push(["Di-mute & ditutup dalam caption", `${g.muted} perkataan`]);
  return (
    <div className="text-[10px] mb-2 leading-snug">
      <span className="inline-flex items-center gap-1 font-bold text-green-500">
        <ShieldCheck className="w-3 h-3 flex-shrink-0" />
        {rows.length ? "Guideline TikTok" : "Guideline TikTok: tiada claim berisiko dijumpai"}
      </span>
      {rows.map(([k, v]) => (
        <span key={k} className="block mt-0.5 text-[var(--color-text-secondary)]">
          <span className="font-bold text-[var(--color-text-primary)]">{k}:</span> {v}
        </span>
      ))}
    </div>
  );
}

export function MotionProgress({ id, preview, isVideo }: { id: string; preview?: string | null; isVideo?: boolean }) {
  const [p, setP] = useState<Prog | null>(() => state.get(id) ?? null);
  useEffect(() => watch(id, setP), [id]);
  const stage = String(p?.stage || "queued");
  const pct = Math.max(3, Math.min(99, Number(p?.pct) || PLANNING_PCT[stage] || 3));
  return (
    <div className="absolute inset-0 overflow-hidden">
      {preview && (isVideo ? (
        <video src={`${preview}#t=0.5`} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover opacity-35" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" />
      ))}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.7))" }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-white" />
        <span className="text-[11px] font-extrabold text-white leading-tight">{MOTION_STAGE_LABEL[stage] || stage}</span>
        <div className="w-4/5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.18)" }}>
          <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(135deg,#a855f7,#ec4899)" }} />
        </div>
        <span className="text-[10px] font-mono text-white/80">{pct}% · boleh tutup tab</span>
      </div>
    </div>
  );
}
