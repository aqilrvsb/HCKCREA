"use client";

// CLIPPER tab — a long video → its most viral clips.
//   1. Sumber: a YouTube link (read through Cloudflare WARP — YouTube bot-checks our servers' own IPs), a Google Drive
//      link (≤ 12 GB, server to server) or an upload (≤ 1 GB).
//   2. Analisa: a Modal job reads the transcript + "most replayed" (or the voice-energy curve), the master director
//      (Sonnet 5.5) picks the clips (title, hook, score, caption, hashtags) — /api/clipper/*, lib/clipper.ts.
//   3. Studio: tick clips, edit their title / hook / timing, pick how they're made (captions only, the full AI edit,
//      or one of the 40 styles) and render. Each clip is a History card below (Motion engine: 9:16 reframe around the
//      speaker, captions, HyperFrames). Finished clips download one by one or as a ZIP.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, Flame, HardDrive, Link2, Loader2, Play, ScissorsLineDashed, Search, Trash2, Upload, X } from "lucide-react";
import { LOCK_CAPTION_LOOKS } from "@/lib/motion-manual";
import { uploadImage } from "@/lib/upload-image";
import MotionStylePicker from "./motion-style-picker";
import { withRetry } from "./motion-photo-picker";

type SrcType = "youtube" | "gdrive" | "upload";
type Clip = {
  start: number; end: number; title: string; hook: string; score: number; reason: string; caption: string;
  hashtags: string[]; quote: string; text: string; interest?: number;
  scores?: { hook: number; flow: number; value: number; payoff: number };
  flash?: { start: number; end: number } | null;
  speakers?: string[];
  visual?: { score: number; note: string };
};
type Render = { id: string; status: string; url: string | null; title: string; start: number | null };
type Job = {
  id: string; status: string; stage: string | null; pct: number | null; error: string | null; created_at: string;
  source: { type: SrcType; url: string; name?: string; video_id?: string } | null;
  options: { duration: string; count: string | number } | null;
  analysis: {
    title?: string | null; channel?: string | null; duration: number; thumb?: string | null; video_id?: string | null; language?: string | null;
    media_url?: string | null; heatmap: { start: number; end: number; value: number }[]; summary: string; clips: Clip[]; caption_source?: string;
  } | null;
  renders: Render[];
};

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };
const label = "block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none";
const inputStyle = { border: `1px solid ${THEME.soft}`, color: "var(--color-text)" } as const;
const PREFS_KEY = "clipper-studio";
const STAGE: Record<string, string> = {
  queued: "Dalam giliran", source: "Baca video", download: "Muat turun video", upload: "Simpan video", transcript: "Baca transkrip",
  audio: "Muat turun audio", speakers: "Kenal pasti penutur & bunyi", director: "AI director pilih klip viral", vision: "AI tengok klip terbaik",
  save: "Simpan hasil", done: "Siap", failed: "Gagal",
};

const on = { background: THEME.gradient, color: "white", boxShadow: `0 4px 12px ${THEME.soft}`, border: "1px solid transparent" };
const off = { background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" };
function Chip({ active, onClick, children, title, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      className="px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition-all inline-flex items-center gap-1.5 disabled:opacity-50" style={active ? on : off}>
      {children}
    </button>
  );
}

const ytId = (u: string) => /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(u)?.[1] ?? null;
const fmt = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
/** "1:23", "01:02:03" or "83" → seconds (NaN when it isn't a time) */
const parseTime = (v: string) => {
  const p = v.trim().split(":").map((x) => Number(x));
  if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
};

function readDuration(file: File): Promise<number> {
  return new Promise((res) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const u = URL.createObjectURL(file);
    v.onloadedmetadata = () => { res(Number(v.duration) || 0); URL.revokeObjectURL(u); };
    v.onerror = () => { res(0); URL.revokeObjectURL(u); };
    v.src = u;
  });
}

function Heatmap({ a, clips, picked, onPick }: { a: NonNullable<Job["analysis"]>; clips: Clip[]; picked: Set<number>; onPick: (i: number) => void }) {
  const W = 1000, H = 60;
  const dur = Math.max(1, a.duration || (a.heatmap.length ? a.heatmap[a.heatmap.length - 1].end : 1));
  const pts = a.heatmap.length ? a.heatmap : [];
  const path = pts.length
    ? `M0,${H} ` + pts.map((p) => `L${((((p.start + p.end) / 2) / dur) * W).toFixed(1)},${(H - 4 - p.value * (H - 10)).toFixed(1)}`).join(" ") + ` L${W},${H} Z`
    : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14 rounded-lg" style={{ background: "rgba(0,0,0,0.25)" }}>
      {path && <path d={path} fill="rgba(168,85,247,0.35)" stroke="#a855f7" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {clips.map((c, i) => (
        <rect key={i} x={(c.start / dur) * W} y={0} width={Math.max(3, ((c.end - c.start) / dur) * W)} height={H}
          fill={picked.has(i) ? "rgba(236,72,153,0.45)" : "rgba(255,255,255,0.12)"} stroke={picked.has(i) ? "#ec4899" : "none"}
          style={{ cursor: "pointer" }} onClick={() => onPick(i)}>
          <title>{`${i + 1}. ${c.title} (${fmt(c.start)}–${fmt(c.end)})`}</title>
        </rect>
      ))}
    </svg>
  );
}

export default function ClipperTab({ projectId }: { projectId?: string }) {
  // ── source + options ──
  const [srcType, setSrcType] = useState<SrcType>("youtube");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; dur: number; url?: string; pct: number; error?: string } | null>(null);
  const [duration, setDuration] = useState<"15" | "30" | "60" | "auto">("30");
  const [count, setCount] = useState<"auto" | number>("auto");
  const [language, setLanguage] = useState<"auto" | "ms" | "en" | "id">("auto");
  const [focus, setFocus] = useState("");
  const [more, setMore] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── analyses ──
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<number, Partial<Clip>>>>({});
  const [picked, setPicked] = useState<Record<string, number[]>>({});
  const [preview, setPreview] = useState<{ job: string; i: number } | null>(null);
  const [played, setPlayed] = useState<string | null>(null); // a finished clip playing inline (render id)
  const pendingRef = useRef<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  // ── studio ──
  const [mode, setMode] = useState<"captions" | "auto" | "style">("captions");
  const [styleId, setStyleId] = useState<string | undefined>();
  const [frame, setFrame] = useState<"face" | "fit" | "center" | "split">("face");
  const [captions, setCaptions] = useState(true);
  const [captionLook, setCaptionLook] = useState<string | undefined>();
  const [captionPos, setCaptionPos] = useState<"low" | "mid">("low");
  const [hookOn, setHookOn] = useState(true);
  const [music, setMusic] = useState(false);
  const [sfx, setSfx] = useState(true);
  const [jumpcut, setJumpcut] = useState(true);
  const [coldOpen, setColdOpen] = useState(true);
  const [polish, setPolish] = useState(true);
  const [wmText, setWmText] = useState("");
  const [wmImage, setWmImage] = useState("");
  const [wmBusy, setWmBusy] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const [zipping, setZipping] = useState<string | null>(null);

  // the studio choices come back next time
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (["captions", "auto", "style"].includes(p.mode)) setMode(p.mode);
        if (typeof p.styleId === "string") setStyleId(p.styleId);
        if (["face", "fit", "center", "split"].includes(p.frame)) setFrame(p.frame);
        if (typeof p.captions === "boolean") setCaptions(p.captions);
        if (typeof p.captionLook === "string") setCaptionLook(p.captionLook);
        if (p.captionPos === "mid" || p.captionPos === "low") setCaptionPos(p.captionPos);
        if (typeof p.hookOn === "boolean") setHookOn(p.hookOn);
        if (typeof p.music === "boolean") setMusic(p.music);
        if (typeof p.sfx === "boolean") setSfx(p.sfx);
        if (typeof p.jumpcut === "boolean") setJumpcut(p.jumpcut);
        if (typeof p.coldOpen === "boolean") setColdOpen(p.coldOpen);
        if (typeof p.polish === "boolean") setPolish(p.polish);
        if (typeof p.wmText === "string") setWmText(p.wmText);
        if (typeof p.wmImage === "string") setWmImage(p.wmImage);
        if (["15", "30", "60", "auto"].includes(p.duration)) setDuration(p.duration);
      }
    } catch { /* private mode */ }
    fetch("/api/motion/rate").then((r) => r.json()).then((d) => setRate(Number(d?.rate) || null)).catch(() => undefined);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, styleId, frame, captions, captionLook, captionPos, hookOn, music, sfx, jumpcut, coldOpen, polish, wmText, wmImage, duration })); } catch { /* private mode */ }
  }, [mode, styleId, frame, captions, captionLook, captionPos, hookOn, music, sfx, jumpcut, coldOpen, polish, wmText, wmImage, duration]);

  // ── the analyses list (polled while something runs) ──
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/clipper/jobs${projectId ? `?project_id=${projectId}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Gagal muat analisa");
      const list: Job[] = d.jobs || [];
      setJobs(list);
      setOpenId((cur) => cur ?? list.find((j) => j.status === "done" && j.analysis?.clips?.length)?.id ?? list[0]?.id ?? null);
    } catch (e: any) {
      setJobs((j) => j ?? []);
      setError(e?.message || "Gagal muat analisa");
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const live = !!jobs?.some((j) => j.status === "pending" || j.renders.some((r) => r.status === "pending"));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [live, load]);
  // a clip that finishes while the page is open: its player opens in the clip's card
  useEffect(() => {
    const now = new Set<string>();
    let done: { job: string; id: string } | null = null;
    for (const j of jobs ?? []) {
      for (const r of j.renders) {
        if (r.status === "pending") now.add(r.id);
        else if (r.status === "done" && r.url && pendingRef.current.has(r.id)) done = { job: j.id, id: r.id };
      }
    }
    pendingRef.current = now;
    if (done) {
      setOpenId(done.job);
      setPlayed(done.id);
      setNotice(now.size ? `✅ Satu klip siap — main terus di kad klip. ${now.size} lagi sedang dijana.` : "✅ Klip siap — main terus di kad klip, atau muat turun.");
    }
  }, [jobs]);
  // a newly finished analysis: its 3 best clips start ticked
  useEffect(() => {
    for (const j of jobs ?? []) {
      if (j.status === "done" && j.analysis?.clips?.length && !picked[j.id]) {
        setPicked((p) => (p[j.id] ? p : { ...p, [j.id]: j.analysis!.clips.slice(0, 3).map((_, i) => i) }));
      }
    }
  }, [jobs, picked]);

  // ── upload ──
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  async function pickFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) return setError("Pilih fail video.");
    if (f.size > 1024 * 1024 * 1024) return setError("Video terlalu besar (maks 1GB) — guna pautan YouTube / Google Drive untuk video lebih besar.");
    const dur = await readDuration(f);
    setFile({ name: f.name, size: f.size, dur, pct: 0 });
    try {
      const r = await fetch("/api/motion/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, size: f.size, kind: "clip" }) });
      const d = await r.json();
      if (!r.ok || !d?.upload_url) throw new Error(d?.error || "Tak dapat link upload");
      const url = await withRetry(() => new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", d.upload_url);
        xhr.setRequestHeader("Content-Type", f.type || "video/mp4");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setFile((x) => (x ? { ...x, pct: Math.round((e.loaded / e.total) * 100) } : x)); };
        xhr.onload = () => {
          try {
            const j = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300 && j?.url) resolve(j.url);
            else reject(Object.assign(new Error(j?.error || `Upload gagal (${xhr.status})`), { retry: xhr.status >= 500 }));
          } catch { reject(Object.assign(new Error(`Upload gagal (${xhr.status})`), { retry: xhr.status >= 500 })); }
        };
        xhr.onerror = () => reject(Object.assign(new Error("Upload gagal — semak sambungan internet."), { retry: true }));
        xhr.send(f);
      }));
      setFile((x) => (x ? { ...x, url, pct: 100 } : x));
    } catch (e: any) {
      setFile((x) => (x ? { ...x, error: e?.message || "Upload gagal" } : x));
    }
  }

  // ── analyse ──
  async function analyse() {
    setError(null);
    setNotice(null);
    let source: { type: SrcType; url: string; name?: string };
    if (srcType === "upload") {
      if (!file?.url) return setError(file ? "Tunggu upload siap dulu." : "Pilih video untuk diupload.");
      source = { type: "upload", url: file.url, name: file.name };
    } else {
      const u = link.trim();
      if (!u) return setError(srcType === "youtube" ? "Tampal pautan YouTube." : "Tampal pautan Google Drive.");
      if (srcType === "youtube" && !ytId(u)) return setError("Pautan YouTube tidak sah.");
      if (srcType === "gdrive" && !/drive\.google\.com|docs\.google\.com/.test(u)) return setError("Tampal pautan fail Google Drive (drive.google.com/file/d/…).");
      source = { type: srcType, url: u };
    }
    let range: { start: number; end: number } | null = null;
    if (more && (rangeFrom.trim() || rangeTo.trim())) {
      const s = parseTime(rangeFrom || "0"), e = parseTime(rangeTo);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e - s < 20) return setError("Julat masa tidak sah (contoh 1:30 hingga 25:00, sekurang-kurangnya 20 saat).");
      range = { start: s, end: e };
    }
    setBusy(true);
    try {
      const r = await fetch("/api/clipper/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, options: { duration, count, focus: focus.trim() || undefined, range, language }, project_id: projectId }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal mula analisa");
      setNotice(`🔍 Analisa bermula — AI baca transkrip & ${srcType === "youtube" ? "data \"most replayed\"" : "tenaga suara"}, kemudian pilih klip paling viral (biasanya 1–4 minit; video 2–3 jam lebih lama).`);
      setOpenId(d.id);
      setLink("");
      setFile(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Gagal mula analisa");
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(id: string) {
    if (!confirm("Padam analisa ini? (Klip yang sudah dijana kekal dalam History.)")) return;
    await fetch(`/api/clipper/jobs?id=${id}`, { method: "DELETE" }).catch(() => undefined);
    setJobs((js) => (js ?? []).filter((j) => j.id !== id));
    if (openId === id) setOpenId(null);
  }

  // ── the open analysis ──
  const job = useMemo(() => jobs?.find((j) => j.id === openId) ?? null, [jobs, openId]);
  const clipsOf = (j: Job): Clip[] => (j.analysis?.clips ?? []).map((c, i) => ({ ...c, ...(edits[j.id]?.[i] ?? {}) }));
  const clips = job ? clipsOf(job) : [];
  const pickSet = new Set(job ? picked[job.id] ?? [] : []);
  const editClip = (i: number, patch: Partial<Clip>) => job && setEdits((e) => ({ ...e, [job.id]: { ...(e[job.id] ?? {}), [i]: { ...(e[job.id]?.[i] ?? {}), ...patch } } }));
  const togglePick = (i: number) => job && setPicked((p) => {
    const cur = new Set(p[job.id] ?? []);
    if (cur.has(i)) cur.delete(i); else cur.add(i);
    return { ...p, [job.id]: [...cur].sort((a, b) => a - b) };
  });
  const nudge = (i: number, which: "start" | "end", by: number) => {
    const c = clips[i];
    const dur = job?.analysis?.duration || Infinity;
    const v = Math.round(Math.max(0, Math.min(dur, c[which] + by)) * 10) / 10;
    if (which === "start" && c.end - v < 3) return;
    if (which === "end" && v - c.start < 3) return;
    editClip(i, { [which]: v } as Partial<Clip>);
  };
  const selClips = clips.filter((_, i) => pickSet.has(i));
  const selSec = selClips.reduce((a, c) => a + Math.ceil(c.end - c.start), 0);
  const estimate = rate ? Math.round(selSec * rate * 100) / 100 : null;
  const renderOf = (c: Clip) => job?.renders.filter((r) => r.start !== null && Math.abs((r.start as number) - c.start) < 0.05) ?? [];
  const doneRenders = job?.renders.filter((r) => r.status === "done" && r.url) ?? [];

  async function render() {
    if (!job) return;
    setError(null);
    setNotice(null);
    if (!selClips.length) return setError("Tick sekurang-kurangnya satu klip.");
    if (mode === "style" && !styleId) return setError("Pilih satu style dulu.");
    setRendering(true);
    try {
      const r = await fetch("/api/clipper/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          project_id: projectId,
          clips: selClips.map((c) => ({ start: c.start, end: c.end, title: c.title, hook: c.hook, flash: c.flash ?? null })),
          settings: { mode, styleId, frame, captions, captionLook, captionPos, hook: hookOn, music, sfx, jumpcut, coldOpen, polish, watermark: { text: wmText.trim() || undefined, image: wmImage || undefined } },
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal mula render");
      setNotice(`🎬 ${d.ids.length} klip sedang dijana serentak${d.failed?.length ? ` (${d.failed.length} gagal dimulakan)` : ""} — setiap klip boleh dimainkan terus di kadnya bila siap.${d.notice ? ` ${d.notice}` : ""}`);
      window.dispatchEvent(new CustomEvent("history:refresh"));
      await load();
    } catch (e: any) {
      setError(e?.message || "Gagal mula render");
    } finally {
      setRendering(false);
    }
  }

  async function zip(j: Job) {
    const ids = j.renders.filter((r) => r.status === "done" && r.url).map((r) => r.id);
    if (!ids.length) return;
    setZipping(j.id);
    setError(null);
    try {
      const r = await fetch("/api/clipper/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      const d = await r.json();
      if (!r.ok || !d?.url) throw new Error(d?.error || "ZIP gagal");
      window.open(d.url, "_blank");
    } catch (e: any) {
      setError(e?.message || "ZIP gagal");
    } finally {
      setZipping(null);
    }
  }

  async function pickLogo(f: File | null) {
    if (!f) return;
    setWmBusy(true);
    try {
      const r = await uploadImage(f);
      setWmImage(r.url);
    } catch (e: any) {
      setError(e?.message || "Upload logo gagal");
    } finally {
      setWmBusy(false);
    }
  }

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); } catch { /* blocked */ }
  };

  const yid = srcType === "youtube" ? ytId(link) : null;
  const canAnalyse = srcType === "upload" ? !!file?.url : !!link.trim();

  return (
    <div className="space-y-4 mb-6">
      {/* ── 1. source ── */}
      <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: "var(--color-bg-elevated, var(--color-bg))", border: "1px solid var(--color-border)" }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: THEME.gradient }}>
            <ScissorsLineDashed className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-[var(--color-text-primary)]">CLIPPER — video panjang jadi klip viral</h2>
            <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug mt-0.5">
              Tampal pautan YouTube / Google Drive atau upload video. AI (Sonnet 5.5) baca transkrip &amp; data &quot;most replayed&quot;, pilih momen paling viral,
              kemudian jana klip 9:16 — kamera ikut muka penutur, caption animasi, hook &amp; edit penuh AI.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Chip active={srcType === "youtube"} onClick={() => setSrcType("youtube")}><Play className="w-3.5 h-3.5" />YouTube</Chip>
          <Chip active={srcType === "gdrive"} onClick={() => setSrcType("gdrive")}><HardDrive className="w-3.5 h-3.5" />Google Drive</Chip>
          <Chip active={srcType === "upload"} onClick={() => setSrcType("upload")}><Upload className="w-3.5 h-3.5" />Upload</Chip>
        </div>

        {srcType !== "upload" ? (
          <div className="space-y-2">
            <label className={label}>{srcType === "youtube" ? "Pautan video YouTube" : "Pautan fail Google Drive"}</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg)]" style={{ border: `1px solid ${THEME.soft}` }}>
              <Link2 className="w-4 h-4 shrink-0" style={{ color: THEME.primary }} />
              <input className="w-full bg-transparent outline-none text-sm text-[var(--color-text)]" value={link} onChange={(e) => setLink(e.target.value)}
                placeholder={srcType === "youtube" ? "https://www.youtube.com/watch?v=…  /  https://youtu.be/…" : "https://drive.google.com/file/d/…/view"} />
              {link && <button type="button" onClick={() => setLink("")} aria-label="Kosongkan"><X className="w-4 h-4 text-[var(--color-text-muted)]" /></button>}
            </div>
            {srcType === "gdrive" && <p className="text-[10px] text-[var(--color-text-muted)]">Fail video mesti dikongsi &quot;Anyone with the link&quot; (Share → General access). Sesuai untuk video besar / panjang (sehingga 12GB).</p>}
            {yid && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://i.ytimg.com/vi/${yid}/mqdefault.jpg`} alt="" className="w-48 rounded-lg" style={{ border: "1px solid var(--color-border)" }} />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className={label}>Video (maks 1GB)</label>
            {!file ? (
              <label className="relative flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border border-dashed cursor-pointer text-[12px] font-bold"
                style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
                <Upload className="w-6 h-6" style={{ color: THEME.primary }} />
                Pilih video panjang (podcast, live, webinar…)
                <input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => { void pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </label>
            ) : (
              <div className="rounded-xl p-3 flex items-center gap-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[var(--color-text-primary)] truncate">{file.name}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">{(file.size / 1024 / 1024).toFixed(0)} MB · {fmt(file.dur)}</div>
                  {file.error ? <div className="text-[10px] text-red-400">{file.error}</div> : (
                    <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--color-border)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${file.pct}%`, background: THEME.gradient }} />
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-bold" style={{ color: file.url ? "#22c55e" : THEME.primary }}>{file.url ? "✓ Siap" : `${file.pct}%`}</span>
                <button type="button" onClick={() => { xhrRef.current?.abort(); setFile(null); }} aria-label="Buang"><X className="w-4 h-4 text-[var(--color-text-muted)]" /></button>
              </div>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Panjang klip</label>
            <div className="flex flex-wrap gap-1.5">
              {(["15", "30", "60", "auto"] as const).map((d) => (
                <Chip key={d} active={duration === d} onClick={() => setDuration(d)}>{d === "auto" ? "✨ Auto (15–90s)" : `~${d}s`}</Chip>
              ))}
            </div>
          </div>
          <div>
            <label className={label}>Bilangan klip</label>
            <div className="flex flex-wrap gap-1.5">
              {(["auto", 3, 5, 8, 10, 15] as const).map((n) => (
                <Chip key={String(n)} active={count === n} onClick={() => setCount(n)}>{n === "auto" ? "✨ Auto" : n}</Chip>
              ))}
            </div>
          </div>
        </div>

        <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1.5 text-[11px] font-extrabold" style={{ color: THEME.primary }}>
          <ChevronDown className="w-4 h-4 transition-transform" style={{ transform: more ? "rotate(180deg)" : "none" }} />
          Lagi pilihan — fokus topik, julat masa, bahasa
        </button>
        {more && (
          <div className="space-y-3">
            <div>
              <label className={label}>Fokus (optional)</label>
              <input className={inputCls} style={inputStyle} value={focus} maxLength={300} onChange={(e) => setFocus(e.target.value)}
                placeholder="cth. bahagian tentang duit / tips bisnes / momen lucu" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Dari (optional)</label>
                <input className={inputCls} style={inputStyle} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} placeholder="0:00" />
              </div>
              <div>
                <label className={label}>Hingga</label>
                <input className={inputCls} style={inputStyle} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} placeholder="cth. 45:00" />
              </div>
            </div>
            <div>
              <label className={label}>Bahasa video</label>
              <div className="flex flex-wrap gap-1.5">
                {([["auto", "✨ Auto"], ["ms", "Melayu"], ["en", "English"], ["id", "Indonesia"]] as const).map(([k, l]) => (
                  <Chip key={k} active={language === k} onClick={() => setLanguage(k)}>{l}</Chip>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <div className="text-xs text-red-400 font-bold">{error}</div>}
        {notice && <div className="text-xs font-bold" style={{ color: THEME.primary }}>{notice}</div>}
        <button type="button" onClick={() => void analyse()} disabled={busy || !canAnalyse}
          className="w-full py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2" style={{ background: THEME.gradient }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Analisa &amp; cari klip viral
        </button>
      </div>

      {/* ── 2. analyses ── */}
      {jobs === null ? (
        <div className="text-xs text-[var(--color-text-muted)] inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Memuat analisa…</div>
      ) : jobs.length > 0 && (
        <div className="space-y-2">
          <div className={label} style={{ marginBottom: 0 }}>Analisa</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {jobs.map((j) => {
              const a = j.analysis;
              const title = a?.title || j.source?.name || j.source?.url || "Video";
              const thumb = a?.thumb || (j.source?.video_id ? `https://i.ytimg.com/vi/${j.source.video_id}/mqdefault.jpg` : null);
              const active = j.id === openId;
              return (
                <button key={j.id} type="button" onClick={() => setOpenId(j.id)} className="shrink-0 w-56 text-left rounded-xl overflow-hidden"
                  style={{ border: active ? `2px solid ${THEME.primary}` : "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                  <div className="relative h-24 bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumb && <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md text-white"
                      style={{ background: j.status === "done" ? "rgba(34,197,94,0.9)" : j.status === "failed" ? "rgba(239,68,68,0.9)" : "rgba(168,85,247,0.95)" }}>
                      {j.status === "done" ? `${a?.clips?.length ?? 0} klip` : j.status === "failed" ? "Gagal" : (STAGE[j.stage || "queued"] || "Sedang analisa")}
                    </span>
                    {j.status === "pending" && <Loader2 className="absolute top-1.5 right-1.5 w-4 h-4 animate-spin text-white" />}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-bold text-[var(--color-text-primary)] line-clamp-2 leading-tight">{title}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{a?.duration ? fmt(a.duration) + " · " : ""}{new Date(j.created_at).toLocaleDateString("ms-MY")}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {job && (
        <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: "var(--color-bg-elevated, var(--color-bg))", border: "1px solid var(--color-border)" }}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold text-[var(--color-text-primary)] leading-snug">{job.analysis?.title || job.source?.name || job.source?.url}</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                {[job.analysis?.channel, job.analysis?.duration ? fmt(job.analysis.duration) : null, job.analysis?.language ? job.analysis.language.toUpperCase() : null,
                  job.analysis?.caption_source === "youtube" ? "transkrip YouTube" : job.analysis?.caption_source === "whisper" ? "transkrip AI" : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" onClick={() => void removeJob(job.id)} title="Padam analisa" className="p-1.5 rounded-lg" style={off}><Trash2 className="w-4 h-4" /></button>
          </div>

          {job.status === "pending" && (
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: THEME.faint, border: `1px solid ${THEME.soft}` }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: THEME.primary }} />
              <div className="flex-1">
                <div className="text-xs font-extrabold text-[var(--color-text-primary)]">{STAGE[job.stage || "queued"] || "Sedang analisa"}…</div>
                <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--color-border)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(5, Math.min(97, job.pct ?? 8))}%`, background: THEME.gradient }} />
                </div>
              </div>
            </div>
          )}
          {job.status === "failed" && <div className="text-xs text-red-400 font-bold">{job.error || "Analisa gagal."}</div>}

          {job.status === "done" && job.analysis && (
            <>
              {job.analysis.summary && <p className="text-[12px] text-[var(--color-text-secondary)] leading-snug">{job.analysis.summary}</p>}
              {job.error && <div className="text-xs text-amber-400 font-bold">{job.error}</div>}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={label} style={{ marginBottom: 0 }}>{!job.analysis.heatmap.length ? "Klip AI" : job.source?.type === "youtube" ? "Paling ramai tonton semula + klip AI" : "Tenaga suara + klip AI"}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">klik jalur untuk pilih</span>
                </div>
                <Heatmap a={job.analysis} clips={clips} picked={pickSet} onPick={togglePick} />
              </div>

              {/* the clips */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={label} style={{ marginBottom: 0 }}>{clips.length} klip · {pickSet.size} dipilih</span>
                <button type="button" className="text-[11px] font-bold underline" style={{ color: THEME.primary }}
                  onClick={() => setPicked((p) => ({ ...p, [job.id]: pickSet.size === clips.length ? [] : clips.map((_, i) => i) }))}>
                  {pickSet.size === clips.length ? "Nyahpilih semua" : "Pilih semua"}
                </button>
                {doneRenders.length > 0 && (
                  <button type="button" onClick={() => void zip(job)} disabled={zipping === job.id} className="ml-auto px-3 py-1.5 rounded-xl text-[11px] font-extrabold inline-flex items-center gap-1.5" style={off}>
                    {zipping === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Muat turun {doneRenders.length} klip (ZIP)
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {clips.map((c, i) => {
                  const sel = pickSet.has(i);
                  const rs = renderOf(c);
                  const isPrev = preview?.job === job.id && preview.i === i;
                  return (
                    <div key={i} className="rounded-xl p-3 space-y-2" style={{ border: sel ? `1.5px solid ${THEME.primary}` : "1px solid var(--color-border)", background: sel ? THEME.faint : "var(--color-bg)" }}>
                      <div className="flex items-start gap-2.5">
                        <button type="button" onClick={() => togglePick(i)} aria-pressed={sel} aria-label="Pilih klip"
                          className="w-5 h-5 mt-0.5 rounded-md shrink-0 flex items-center justify-center" style={sel ? { background: THEME.gradient } : { border: "1.5px solid var(--color-border)" }}>
                          {sel && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 text-white"
                              style={{ background: c.score >= 85 ? "#ef4444" : c.score >= 70 ? "#f59e0b" : "#64748b" }}>
                              <Flame className="w-3 h-3" />{c.score}
                            </span>
                            <span className="text-[11px] font-bold text-[var(--color-text-secondary)]">#{i + 1} · {fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)}s</span>
                            {typeof c.interest === "number" && c.interest > 0 && <span className="text-[10px] text-[var(--color-text-muted)]">{job.source?.type === "youtube" ? "replay" : "tenaga"} {Math.round(c.interest * 100)}%</span>}
                            {c.scores && (
                              <span className="text-[10px] text-[var(--color-text-muted)]" title="Penilaian AI (0–10): hook 3 saat pertama · faham tanpa konteks · nilai/emosi · penutup padu">
                                Hook {c.scores.hook} · Faham {c.scores.flow} · Nilai {c.scores.value} · Penutup {c.scores.payoff}
                              </span>
                            )}
                            {c.flash && <span className="text-[10px] font-bold" style={{ color: THEME.primary }} title="Dibuka dengan ayat paling padu (cold open)">⚡ cold open</span>}
                            {c.visual && (
                              <span className="text-[10px] text-[var(--color-text-muted)]" title={c.visual.note ? `AI tengok klip: ${c.visual.note}` : "AI tengok 6 frame klip ini"}>
                                👁 Visual {c.visual.score}/10{c.visual.note ? ` · ${c.visual.note}` : ""}
                              </span>
                            )}
                            {/* oldest first: a failed attempt hides once a newer one exists (a retry that worked) */}
                            {rs.filter((r, k) => r.status !== "failed" || k === rs.length - 1).map((r) => (
                              <span key={r.id} className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md"
                                style={{ background: r.status === "done" ? "rgba(34,197,94,0.15)" : r.status === "failed" ? "rgba(239,68,68,0.15)" : THEME.faint,
                                  color: r.status === "done" ? "#22c55e" : r.status === "failed" ? "#ef4444" : THEME.primary }}>
                                {r.status === "done"
                                  ? (r.url ? <button type="button" onClick={() => setPlayed(played === r.id ? null : r.id)}>{played === r.id ? "✓ Siap — tutup" : "✓ Siap — ▶ Main"}</button> : "✓ Siap")
                                  : r.status === "failed" ? "Gagal" : "⏳ Dijana"}
                              </span>
                            ))}
                          </div>
                          <input className={`${inputCls} font-bold`} style={inputStyle} value={c.title} maxLength={90} onChange={(e) => editClip(i, { title: e.target.value })} aria-label="Tajuk klip" />
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[var(--color-text-muted)] shrink-0 w-10">Hook</span>
                            <input className={inputCls} style={inputStyle} value={c.hook} maxLength={60} onChange={(e) => editClip(i, { hook: e.target.value })} aria-label="Hook klip" />
                          </div>
                          {c.reason && <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug">💡 {c.reason}</p>}
                          {c.quote && <p className="text-[11px] italic text-[var(--color-text-muted)] leading-snug">“{c.quote}”</p>}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-[var(--color-text-muted)]">Mula</span>
                            {[-5, -1, 1, 5].map((x) => <Chip key={`s${x}`} active={false} onClick={() => nudge(i, "start", x)}>{x > 0 ? `+${x}` : x}s</Chip>)}
                            <span className="text-[10px] font-bold text-[var(--color-text-muted)] ml-2">Tamat</span>
                            {[-5, -1, 1, 5].map((x) => <Chip key={`e${x}`} active={false} onClick={() => nudge(i, "end", x)}>{x > 0 ? `+${x}` : x}s</Chip>)}
                            <span className="ml-auto flex gap-1.5">
                              <Chip active={isPrev} onClick={() => setPreview(isPrev ? null : { job: job.id, i })}><Play className="w-3.5 h-3.5" />{isPrev ? "Tutup" : "Tonton"}</Chip>
                              {(c.caption || c.hashtags.length > 0) && (
                                <Chip active={copied === `${job.id}:${i}`} onClick={() => void copy(`${job.id}:${i}`, `${c.caption}\n\n${c.hashtags.join(" ")}`.trim())}>
                                  {copied === `${job.id}:${i}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}Caption
                                </Chip>
                              )}
                            </span>
                          </div>
                          {isPrev && (
                            <div className="rounded-lg overflow-hidden bg-black aspect-video max-w-xl">
                              {job.source?.type === "youtube" && (job.analysis?.video_id || job.source.video_id) ? (
                                <iframe className="w-full h-full" title={c.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
                                  src={`https://www.youtube.com/embed/${job.analysis?.video_id || job.source.video_id}?start=${Math.floor(c.start)}&end=${Math.ceil(c.end)}&autoplay=1&rel=0`} />
                              ) : job.analysis?.media_url ? (
                                <video className="w-full h-full" controls autoPlay src={`${job.analysis.media_url}#t=${c.start},${c.end}`} />
                              ) : null}
                            </div>
                          )}
                          {rs.filter((r) => r.status === "done" && r.url && played === r.id).map((r) => (
                            <div key={r.id} className="flex items-end gap-3 flex-wrap">
                              <video className="rounded-lg bg-black" style={{ width: 220, aspectRatio: "9 / 16" }} controls autoPlay playsInline preload="metadata" src={r.url!} />
                              <a href={r.url!} target="_blank" rel="noreferrer" download
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white" style={{ background: THEME.gradient }}>
                                <Download className="w-3.5 h-3.5" />Muat turun
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── 3. studio ── */}
              {clips.length > 0 && (
                <div className="rounded-xl p-3 sm:p-4 space-y-4" style={{ border: `1px solid ${THEME.soft}`, background: THEME.faint }}>
                  <div className="text-xs font-extrabold text-[var(--color-text-primary)]">🎬 Studio — cara klip dijana</div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    {([
                      ["captions", "⚡ Klip + caption", "Pantas. Kamera ikut muka, caption animasi & hook — tiada edit tambahan."],
                      ["auto", "🤖 Edit penuh AI", "Master director (Sonnet 5.5) edit setiap klip — hook, sticker, skrin grafik, B-roll."],
                      ["style", "🎨 Ikut style", "Edit penuh AI ikut satu daripada 40 style."],
                    ] as const).map(([k, t, dsc]) => (
                      <button key={k} type="button" onClick={() => setMode(k)} className="text-left px-3 py-2.5 rounded-xl transition-all" style={mode === k ? on : off}>
                        <span className="block text-xs font-extrabold">{t}</span>
                        <span className="block text-[10px] leading-snug mt-0.5" style={{ color: mode === k ? "rgba(255,255,255,0.88)" : "var(--color-text-muted)" }}>{dsc}</span>
                      </button>
                    ))}
                  </div>
                  {mode === "style" && <MotionStylePicker value={styleId} onChange={setStyleId} />}

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className={label}>Bingkai 9:16</label>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip active={frame === "face"} onClick={() => setFrame("face")} title="Kamera ikut muka; bila 2–3 orang, AI potong ke orang yang sedang bercakap">🎯 Ikut penutur (AI)</Chip>
                        <Chip active={frame === "split"} onClick={() => setFrame("split")} title="Bila 2 orang dalam satu shot: kedua-duanya, atas & bawah">👥 2 orang atas-bawah</Chip>
                        <Chip active={frame === "fit"} onClick={() => setFrame("fit")} title="Seluruh frame atas latar kabur">🖼️ Penuh + latar kabur</Chip>
                        <Chip active={frame === "center"} onClick={() => setFrame("center")}>⬛ Tengah</Chip>
                      </div>
                    </div>
                    <div>
                      <label className={label}>Potong jeda panjang</label>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip active={jumpcut} onClick={() => setJumpcut(true)} title="Jeda lebih 0.6 saat dipendekkan — rentak lebih laju, suara kekal natural">Ya</Chip>
                        <Chip active={!jumpcut} onClick={() => setJumpcut(false)}>Tidak</Chip>
                      </div>
                    </div>
                    <div>
                      <label className={label}>Hook di 3 saat pertama</label>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip active={hookOn} onClick={() => setHookOn(true)}>Ada</Chip>
                        <Chip active={!hookOn} onClick={() => setHookOn(false)}>Tiada</Chip>
                      </div>
                    </div>
                    <div>
                      <label className={label}>Buka dengan punchline</label>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip active={coldOpen} onClick={() => setColdOpen(true)} title="Klip yang AI tanda ⚡ dibuka dengan ayat paling padu (2–3 saat), kemudian main dari awal">Ya</Chip>
                        <Chip active={!coldOpen} onClick={() => setColdOpen(false)}>Tidak</Chip>
                      </div>
                    </div>
                    {mode === "captions" && (
                      <div>
                        <label className={label}>Highlight kata kunci + zoom</label>
                        <div className="flex flex-wrap gap-1.5">
                          <Chip active={polish} onClick={() => setPolish(true)} title="Kata penting berwarna + emoji, zoom masuk pada ayat penting, bar progres">Ya</Chip>
                          <Chip active={!polish} onClick={() => setPolish(false)}>Tidak</Chip>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className={label}>Caption</label>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip active={captions} onClick={() => setCaptions(true)}>Ada</Chip>
                      <Chip active={!captions} onClick={() => setCaptions(false)}>Tiada</Chip>
                      {captions && (
                        <>
                          <span className="w-px self-stretch mx-1" style={{ background: "var(--color-border)" }} />
                          <Chip active={!captionLook} onClick={() => setCaptionLook(undefined)}>✨ AI pilih</Chip>
                          {LOCK_CAPTION_LOOKS.map((c) => <Chip key={c.id} active={captionLook === c.id} onClick={() => setCaptionLook(c.id)} title={c.desc}>{c.label}</Chip>)}
                          <span className="w-px self-stretch mx-1" style={{ background: "var(--color-border)" }} />
                          <Chip active={captionPos === "low"} onClick={() => setCaptionPos("low")}>Bawah</Chip>
                          <Chip active={captionPos === "mid"} onClick={() => setCaptionPos("mid")}>Tengah</Chip>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex flex-wrap gap-x-5 gap-y-3">
                      <div>
                        <label className={label}>Muzik latar</label>
                        <div className="flex gap-1.5"><Chip active={music} onClick={() => setMusic(true)}>Ada</Chip><Chip active={!music} onClick={() => setMusic(false)}>Tiada</Chip></div>
                      </div>
                      <div>
                        <label className={label}>Bunyi hook / SFX</label>
                        <div className="flex gap-1.5"><Chip active={sfx} onClick={() => setSfx(true)}>Ada</Chip><Chip active={!sfx} onClick={() => setSfx(false)}>Tiada</Chip></div>
                      </div>
                    </div>
                    <div>
                      <label className={label}>Watermark (optional)</label>
                      <div className="flex items-center gap-2">
                        <input className={inputCls} style={inputStyle} value={wmText} maxLength={40} onChange={(e) => setWmText(e.target.value)} placeholder="@akaunanda" />
                        <label className="relative shrink-0 px-2.5 py-2 rounded-lg text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1.5" style={wmImage ? on : off}>
                          {wmBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}{wmImage ? "Logo ✓" : "Logo"}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={(e) => { void pickLogo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                        </label>
                        {wmImage && <button type="button" onClick={() => setWmImage("")} aria-label="Buang logo"><X className="w-4 h-4 text-[var(--color-text-muted)]" /></button>}
                      </div>
                    </div>
                  </div>

                  <button type="button" onClick={() => void render()} disabled={rendering || !selClips.length}
                    className="w-full py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2" style={{ background: THEME.gradient }}>
                    {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScissorsLineDashed className="w-4 h-4" />}
                    Jana {selClips.length} klip{selSec ? ` · ${selSec}s` : ""}{estimate !== null && selSec ? ` · ~RM${estimate.toFixed(2)}` : ""}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
