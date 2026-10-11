"use client";

// Motion tab — AI motion-graphics videos (Remotion on Modal).
//   🎬 Buat Iklan  — product brief → AI script + storyboard → voice → animated ad (1–3 variations)
//   ✂️ Edit Video  — client's own videos (up to 5 at once) → jump cuts, hook, word-synced
//                    stickers, Google B-roll + fact cards, face zooms, captions, SFX
// Every job runs on the server in the background (closing the tab is fine);
// the Jobs panel tracks them live (/api/motion/status) and finished videos
// land in the Motion history grid below.

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Loader2, Upload, X, Download, Sparkles, Scissors, CheckCircle2, AlertTriangle, Brain, Wand2 } from "lucide-react";
import { uploadImage } from "@/lib/upload-image";
import { MOTION_AD_PRESETS, MOTION_EDIT_PRESETS, type MotionPreset } from "@/lib/motion-prompts";

type Mode = "ad" | "edit";
type CaptionStyle = "pop" | "karaoke" | "box";
type Job = {
  id: string;
  status: string;
  feature?: string;
  stage?: string | null;
  pct?: number | null;
  output_url?: string | null;
  poster_url?: string | null;
  cost?: number;
  error?: string | null;
  label?: string;
};
type VideoPick = { key: string; file: File; dur: number; preview: string; uploadedUrl?: string; pct?: number | null; error?: string | null };

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };
const MAX_VIDEOS = 5;
const MAX_SEC = 180;

const VOICES = [
  { key: "mira", label: "Mira", g: "♀" },
  { key: "afifah", label: "Afifah", g: "♀" },
  { key: "nana", label: "Nana", g: "♀" },
  { key: "mila", label: "Mila", g: "♀" },
  { key: "jamal", label: "Jamal", g: "♂" },
  { key: "aqil", label: "Aqil", g: "♂" },
];

const STAGE_LABEL: Record<string, string> = {
  queued: "Dalam giliran",
  script: "AI tulis skrip & storyboard",
  voice: "Jana suara",
  align: "Selaraskan suara & teks",
  music: "Gubah muzik",
  images: "Potong gambar produk",
  download: "Muat turun video",
  transcribe: "Transkrip suara",
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

const label = "block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none";
const inputStyle = { border: `1px solid ${THEME.soft}`, color: "var(--color-text)" } as const;

function Chip({ active, onClick, children, disabled, small }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${small ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"} rounded-xl font-extrabold transition-all disabled:opacity-50`}
      style={
        active
          ? { background: THEME.gradient, color: "white", boxShadow: `0 4px 12px ${THEME.soft}`, border: "1px solid transparent" }
          : { background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }
      }
    >
      {children}
    </button>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
      style={{ background: on ? THEME.faint : "var(--color-bg)", border: `1px solid ${on ? THEME.primary : "var(--color-border)"}`, color: "var(--color-text-primary)" }}
    >
      <span className="w-7 h-4 rounded-full relative transition" style={{ background: on ? THEME.primary : "var(--color-border)" }}>
        <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: on ? 14 : 2 }} />
      </span>
      {children}
    </button>
  );
}

function PromptBox({ value, onChange, presets, placeholder }: { value: string; onChange: (v: string) => void; presets: MotionPreset[]; placeholder: string }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? presets : presets.slice(0, 8);
  return (
    <div>
      <label className={label}>Prompt (arahan untuk AI director)</label>
      <textarea className={`${inputCls} resize-y`} style={inputStyle} rows={3} maxLength={900} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {shown.map((p) => (
          <button key={p.id} type="button" title={p.prompt} onClick={() => onChange(p.prompt)}
            className="px-2.5 py-1 rounded-full text-[11px] font-bold transition hover:scale-105"
            style={{ background: value === p.prompt ? THEME.gradient : THEME.faint, color: value === p.prompt ? "white" : "var(--color-text-primary)",
              border: `1px solid ${THEME.soft}` }}>
            {p.label}
          </button>
        ))}
        {presets.length > 8 && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="px-2.5 py-1 rounded-full text-[11px] font-bold underline"
            style={{ color: "var(--color-text-secondary)" }}>{showAll ? "Kurang" : `+${presets.length - 8} lagi`}</button>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Tekan cadangan (trend beg kuning Malaysia) atau tulis sendiri. AI tak akan reka harga, rating atau stok.</p>
    </div>
  );
}

const jobsKey = (projectId?: string) => `motion-jobs:${projectId || "none"}`;
const loadJobIds = (projectId?: string): string[] => {
  try { return JSON.parse(localStorage.getItem(jobsKey(projectId)) || "[]").slice(0, 12); } catch { return []; }
};
const saveJobIds = (projectId: string | undefined, ids: string[]) => {
  try { localStorage.setItem(jobsKey(projectId), JSON.stringify(ids.slice(0, 12))); } catch { /* storage blocked */ }
};

const readDuration = (url: string) =>
  new Promise<number>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(v.duration || 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });

export default function MotionTab({ projectId }: { projectId?: string }) {
  const [mode, setMode] = useState<Mode>("edit");
  const [rate, setRate] = useState<number | null>(null);
  const [brain, setBrain] = useState<string | null>(null);

  // shared
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("pop");
  const [style, setStyle] = useState<"gempak" | "clean">("gempak");
  const [resolution, setResolution] = useState<"1080" | "720">("1080");
  const [sfx, setSfx] = useState(true);
  const [accent, setAccent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Buat Iklan
  const [product, setProduct] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [cta, setCta] = useState("");
  const [handle, setHandle] = useState("");
  const [adPrompt, setAdPrompt] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [voice, setVoice] = useState("mira");
  const [language, setLanguage] = useState<"ms" | "en">("ms");
  const [music, setMusic] = useState(true);
  const [variations, setVariations] = useState(1);
  const [images, setImages] = useState<{ url: string; role: "product" | "presenter" }[]>([]);
  const [imgBusy, setImgBusy] = useState(false);

  // Edit Video
  const [videos, setVideos] = useState<VideoPick[]>([]);
  const [editLang, setEditLang] = useState<"ms" | "en" | "auto">("ms");
  const [captionPos, setCaptionPos] = useState<"low" | "mid">("low");
  const [editMusic, setEditMusic] = useState(false);
  const [jumpcut, setJumpcut] = useState(true);
  const [broll, setBroll] = useState(true);
  const [facts, setFacts] = useState(true);
  const [editPrompt, setEditPrompt] = useState(MOTION_EDIT_PRESETS[0]?.prompt ?? "");
  const [context, setContext] = useState("");

  // jobs
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const lastStatus = useRef<Record<string, string>>({});
  const jobLabels = useRef<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/motion/rate").then((r) => r.json()).then((d) => { setRate(Number(d?.rate) || 0); setBrain(d?.brain || null); }).catch(() => setRate(0));
    setJobIds(loadJobIds(projectId));
  }, [projectId]);

  // live job polling (all jobs in parallel)
  useEffect(() => {
    if (jobIds.length === 0) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/motion/status?ids=${jobIds.join(",")}`, { cache: "no-store" });
        const d = await r.json();
        if (stop) return;
        const next: Record<string, Job> = {};
        let justFinished = false;
        for (const j of (d?.jobs || []) as Job[]) {
          next[j.id] = { ...j, label: jobLabels.current[j.id] };
          if (j.status !== "pending" && lastStatus.current[j.id] === "pending") justFinished = true;
          lastStatus.current[j.id] = j.status;
        }
        setJobs(next);
        if (justFinished) window.dispatchEvent(new CustomEvent("history:refresh"));
        if (Object.values(next).some((j) => j.status === "pending")) timer = setTimeout(tick, 5000);
      } catch {
        if (!stop) timer = setTimeout(tick, 8000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobIds]);

  const addJobs = (ids: string[], labels: string[]) => {
    ids.forEach((id, k) => { jobLabels.current[id] = labels[k]; lastStatus.current[id] = "pending"; });
    setJobIds((cur) => {
      const next = [...ids, ...cur.filter((x) => !ids.includes(x))].slice(0, 12);
      saveJobIds(projectId, next);
      return next;
    });
    setJobs((j) => ({ ...j, ...Object.fromEntries(ids.map((id, k) => [id, { id, status: "pending", stage: "queued", label: labels[k] }])) }));
  };
  const dismissJob = (id: string) => {
    setJobIds((cur) => { const next = cur.filter((x) => x !== id); saveJobIds(projectId, next); return next; });
  };

  const adCost = rate !== null ? Math.ceil(seconds + 2) * rate * variations : null;
  const editSec = videos.reduce((s, v) => s + Math.ceil(Math.min(v.dur || 0, MAX_SEC)), 0);
  const editCost = rate !== null && editSec > 0 ? editSec * rate : null;

  // ── images ──
  async function addImages(files: FileList | null, role: "product" | "presenter") {
    if (!files || files.length === 0) return;
    setError(null);
    setImgBusy(true);
    try {
      const room = role === "presenter" ? 1 : Math.max(0, 3 - images.filter((i) => i.role === "product").length);
      for (const f of Array.from(files).slice(0, room)) {
        const r = await uploadImage(f);
        setImages((cur) => {
          const base = role === "presenter" ? cur.filter((i) => i.role !== "presenter") : cur;
          return [...base, { url: r.url, role }];
        });
      }
    } catch (e: any) {
      setError(e?.message || "Upload gambar gagal");
    } finally {
      setImgBusy(false);
    }
  }

  // ── videos ──
  async function addVideos(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const room = MAX_VIDEOS - videos.length;
    const picked: VideoPick[] = [];
    for (const f of Array.from(list).slice(0, room)) {
      if (f.size > 300 * 1024 * 1024) { setError(`${f.name}: terlalu besar (maks 300MB).`); continue; }
      const preview = URL.createObjectURL(f);
      const dur = await readDuration(preview);
      if (!(dur > 0.5)) { setError(`${f.name}: video tidak boleh dibaca — cuba MP4.`); URL.revokeObjectURL(preview); continue; }
      picked.push({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, dur, preview });
    }
    setVideos((cur) => [...cur, ...picked].slice(0, MAX_VIDEOS));
    if (Array.from(list).length > room) setNotice(`Maksimum ${MAX_VIDEOS} video sekali hantar.`);
  }
  const removeVideo = (key: string) => setVideos((cur) => {
    const v = cur.find((x) => x.key === key);
    if (v) URL.revokeObjectURL(v.preview);
    return cur.filter((x) => x.key !== key);
  });
  const patchVideo = (key: string, patch: Partial<VideoPick>) => setVideos((cur) => cur.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  async function uploadVideo(v: VideoPick): Promise<string> {
    const r = await fetch("/api/motion/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: v.file.name, size: v.file.size }),
    });
    const d = await r.json();
    if (!r.ok || !d?.upload_url) throw new Error(d?.error || "Tak dapat link upload");
    return await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", d.upload_url);
      xhr.setRequestHeader("Content-Type", v.file.type || "video/mp4");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) patchVideo(v.key, { pct: Math.round((e.loaded / e.total) * 100) }); };
      xhr.onload = () => {
        try {
          const j = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && j?.url) resolve(j.url);
          else reject(new Error(j?.error || `Upload gagal (${xhr.status})`));
        } catch { reject(new Error(`Upload gagal (${xhr.status})`)); }
      };
      xhr.onerror = () => reject(new Error("Upload gagal — semak sambungan internet."));
      xhr.send(v.file);
    });
  }

  // ── submit ──
  async function submitAd() {
    setError(null);
    setNotice(null);
    if (!product.trim()) return setError("Isi nama produk.");
    if (description.trim().length < 10) return setError("Terangkan produk sekurang-kurangnya satu ayat.");
    setSubmitting(true);
    try {
      const r = await fetch("/api/motion/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product, description, price, old_price: oldPrice, cta, handle, prompt: adPrompt, seconds, voice, language,
          captions, caption_style: captionStyle, music, sfx, accent: accent || undefined, images, project_id: projectId,
          style, resolution, variations,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
      const ids: string[] = d.ids || [d.id];
      addJobs(ids, ids.map((_, k) => (ids.length > 1 ? `Iklan · variasi ${k + 1}` : "Iklan")));
      if (d.warning) setNotice(d.warning);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit() {
    setError(null);
    setNotice(null);
    if (videos.length === 0) return setError("Pilih sekurang-kurangnya satu video.");
    setSubmitting(true);
    let started = 0;
    const failed: string[] = [];
    // Two uploads at a time; every video becomes its own background job.
    const queue = [...videos];
    const worker = async () => {
      while (queue.length) {
        const v = queue.shift()!;
        try {
          patchVideo(v.key, { error: null, pct: 0 });
          const url = v.uploadedUrl || (await uploadVideo(v));
          patchVideo(v.key, { uploadedUrl: url, pct: 100 });
          const r = await fetch("/api/motion/edit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              video_url: url, duration_sec: v.dur, language: editLang, prompt: editPrompt, product: context,
              captions, caption_style: captionStyle, caption_pos: captionPos, music: editMusic, sfx,
              accent: accent || undefined, project_id: projectId, style, resolution, jumpcut, broll, facts,
            }),
          });
          const d = await r.json();
          if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
          addJobs([d.id], [`Edit · ${v.file.name.slice(0, 28)}`]);
          started++;
          removeVideo(v.key);
          if (r.status === 402) break;
        } catch (e: any) {
          patchVideo(v.key, { error: e?.message || "Gagal" });
          failed.push(`${v.file.name}: ${e?.message || "gagal"}`);
          if (String(e?.message || "").startsWith("Kredit")) { queue.length = 0; }
        }
      }
    };
    await Promise.all([worker(), worker()]);
    window.dispatchEvent(new CustomEvent("history:refresh"));
    if (failed.length) setError(failed.join(" · "));
    if (started) setNotice(`${started} video sedang diedit di belakang tabir — boleh tutup tab, hasil masuk History.`);
    setSubmitting(false);
  }

  const visibleJobs = useMemo(() => jobIds.map((id) => jobs[id]).filter(Boolean) as Job[], [jobIds, jobs]);
  const presets = mode === "ad" ? MOTION_AD_PRESETS : MOTION_EDIT_PRESETS;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 border" style={{ background: `linear-gradient(135deg, ${THEME.faint}, transparent)`, borderColor: THEME.soft }}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Clapperboard className="w-5 h-5" style={{ color: THEME.primary }} strokeWidth={2.4} />
          <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">Motion</h2>
          {brain && (
            <span className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
              style={{ background: THEME.faint, border: `1px solid ${THEME.soft}`, color: "var(--color-text-secondary)" }}>
              <Brain className="w-3 h-3" /> AI: {brain}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Edit macam editor pro TikTok — AI director potong senyap, tambah hook, sticker, gambar Google, fakta, zoom ke muka,
          caption berwarna, sound effect & CTA beg kuning yang sync dengan setiap perkataan. Boleh hantar banyak sekali; semua jalan di belakang tabir.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          <Chip active={mode === "edit"} onClick={() => setMode("edit")}><Scissors className="inline w-3.5 h-3.5 mr-1" />Edit Video</Chip>
          <Chip active={mode === "ad"} onClick={() => setMode("ad")}><Sparkles className="inline w-3.5 h-3.5 mr-1" />Buat Iklan</Chip>
        </div>

        {mode === "edit" ? (
          <div className="space-y-4">
            <div>
              <label className={label}>Video anda * (sehingga {MAX_VIDEOS} video · maks 3 minit · 300MB setiap satu)</label>
              <div className="flex flex-wrap gap-3">
                {videos.map((v) => (
                  <div key={v.key} className="relative w-28">
                    <video src={v.preview} className="w-28 rounded-lg bg-black" style={{ aspectRatio: "9/16", objectFit: "cover" }} muted playsInline />
                    <button type="button" onClick={() => removeVideo(v.key)} disabled={submitting} className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5">
                      <X className="w-3 h-3 text-white" />
                    </button>
                    <div className="text-[10px] mt-1 text-[var(--color-text-secondary)] truncate">{v.file.name}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)]">{v.dur.toFixed(1)}s{v.dur > MAX_SEC ? " (3 min pertama)" : ""}{typeof v.pct === "number" && v.pct < 100 ? ` · ${v.pct}%` : ""}</div>
                    {v.error && <div className="text-[10px] text-red-400 line-clamp-2">{v.error}</div>}
                  </div>
                ))}
                {videos.length < MAX_VIDEOS && (
                  <label className="w-28 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed cursor-pointer text-[11px] font-bold text-center px-2"
                    style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)", aspectRatio: "9/16" }}>
                    <Upload className="w-5 h-5" style={{ color: THEME.primary }} />
                    {videos.length ? "Tambah video" : "Pilih video (boleh banyak)"}
                    <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v" className="hidden"
                      onChange={(e) => { addVideos(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>
            <PromptBox value={editPrompt} onChange={setEditPrompt} presets={presets} placeholder="cth. Jadikan video jualan beg kuning: hook kuat, tick setiap kelebihan, tutup dengan CTA tekan beg kuning." />
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Produk / konteks (optional)</label>
                <input className={inputCls} style={inputStyle} value={context} maxLength={300} onChange={(e) => setContext(e.target.value)} placeholder="cth. Gluvera patch, RM39, beg kuning" />
              </div>
              <div>
                <label className={label}>Bahasa dalam video</label>
                <div className="flex gap-2">
                  <Chip active={editLang === "ms"} onClick={() => setEditLang("ms")}>Melayu</Chip>
                  <Chip active={editLang === "en"} onClick={() => setEditLang("en")}>English</Chip>
                  <Chip active={editLang === "auto"} onClick={() => setEditLang("auto")}>Auto</Chip>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle on={jumpcut} onChange={setJumpcut}>✂️ Buang senyap & &quot;erm&quot;</Toggle>
              <Toggle on={broll} onChange={setBroll}>🖼️ Gambar Google (B-roll)</Toggle>
              <Toggle on={facts} onChange={setFacts}>💡 Fakta Google</Toggle>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Nama produk *</label>
                <input className={inputCls} style={inputStyle} value={product} maxLength={80} onChange={(e) => setProduct(e.target.value)} placeholder="cth. Kopi Pening" />
              </div>
              <div>
                <label className={label}>Handle / kedai (optional)</label>
                <input className={inputCls} style={inputStyle} value={handle} maxLength={40} onChange={(e) => setHandle(e.target.value)} placeholder="@kedaianda" />
              </div>
            </div>
            <div>
              <label className={label}>Penerangan produk *</label>
              <textarea className={`${inputCls} resize-y`} style={inputStyle} rows={4} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Apa produk ni, untuk siapa, kelebihan utama, bukti sebenar (rating, jualan, sijil — hanya yang betul). AI tak akan reka fakta." />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={label}>Harga</label>
                <input className={inputCls} style={inputStyle} value={price} maxLength={14} onChange={(e) => setPrice(e.target.value)} placeholder="RM19" />
              </div>
              <div>
                <label className={label}>Harga asal</label>
                <input className={inputCls} style={inputStyle} value={oldPrice} maxLength={14} onChange={(e) => setOldPrice(e.target.value)} placeholder="RM29" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={label}>Call to action</label>
                <input className={inputCls} style={inputStyle} value={cta} maxLength={40} onChange={(e) => setCta(e.target.value)} placeholder="Tekan beg kuning" />
              </div>
            </div>
            <PromptBox value={adPrompt} onChange={setAdPrompt} presets={presets} placeholder="cth. Iklan beg kuning gaya hype, fokus price reveal & free shipping (jika ada)." />

            <div>
              <label className={label}>Gambar produk (1–3) · presenter (optional)</label>
              <div className="flex flex-wrap gap-2 items-center">
                {images.map((im, i) => (
                  <div key={im.url} className="relative w-20 h-20 rounded-lg overflow-hidden border" style={{ borderColor: im.role === "presenter" ? "#ec4899" : THEME.soft, background: "#000" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center font-bold text-white" style={{ background: "rgba(0,0,0,0.6)" }}>
                      {im.role === "presenter" ? "Presenter" : `Produk ${i + 1}`}
                    </span>
                    <button type="button" onClick={() => setImages((cur) => cur.filter((x) => x.url !== im.url))} className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                {images.filter((i) => i.role === "product").length < 3 && (
                  <label className="w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer" style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
                    {imgBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Produk
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImages(e.target.files, "product"); e.target.value = ""; }} />
                  </label>
                )}
                {!images.some((i) => i.role === "presenter") && (
                  <label className="w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer" style={{ borderColor: "rgba(236,72,153,0.45)", color: "var(--color-text-secondary)" }}>
                    {imgBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Presenter
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { addImages(e.target.files, "presenter"); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Background gambar dibuang automatik jadi sticker. Tanpa gambar pun boleh — iklan jadi typography penuh.</p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className={label}>Tempoh</label>
                <div className="flex gap-2">{[15, 30, 45].map((s) => <Chip key={s} active={seconds === s} onClick={() => setSeconds(s)}>{s}s</Chip>)}</div>
              </div>
              <div>
                <label className={label}>Variasi (serentak)</label>
                <div className="flex gap-2">{[1, 2, 3].map((n) => <Chip key={n} active={variations === n} onClick={() => setVariations(n)}>{n}</Chip>)}</div>
              </div>
              <div>
                <label className={label}>Bahasa</label>
                <div className="flex gap-2">
                  <Chip active={language === "ms"} onClick={() => setLanguage("ms")}>Melayu</Chip>
                  <Chip active={language === "en"} onClick={() => setLanguage("en")}>English</Chip>
                </div>
              </div>
            </div>
            <div>
              <label className={label}>Suara</label>
              <div className="flex flex-wrap gap-2">{VOICES.map((v) => <Chip key={v.key} active={voice === v.key} onClick={() => setVoice(v.key)}>{v.g} {v.label}</Chip>)}</div>
            </div>
          </div>
        )}

        {/* shared style controls */}
        <div className="mt-5 pt-4 border-t space-y-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex flex-wrap gap-2 items-center">
            <span className={`${label} !mb-0 mr-1`}>Gaya</span>
            <Chip active={style === "gempak"} onClick={() => setStyle("gempak")}>🔥 Gempak</Chip>
            <Chip active={style === "clean"} onClick={() => setStyle("clean")}>✨ Clean</Chip>
            <span className={`${label} !mb-0 ml-3 mr-1`}>Resolusi</span>
            <Chip active={resolution === "1080"} onClick={() => setResolution("1080")}>HD 1080p</Chip>
            <Chip active={resolution === "720"} onClick={() => setResolution("720")}>720p laju</Chip>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Toggle on={captions} onChange={setCaptions}>Caption</Toggle>
            {captions && (
              <>
                <Chip small active={captionStyle === "pop"} onClick={() => setCaptionStyle("pop")}>Pop</Chip>
                <Chip small active={captionStyle === "karaoke"} onClick={() => setCaptionStyle("karaoke")}>Karaoke</Chip>
                <Chip small active={captionStyle === "box"} onClick={() => setCaptionStyle("box")}>Box</Chip>
                {mode === "edit" && (
                  <>
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] ml-2">Kedudukan</span>
                    <Chip small active={captionPos === "low"} onClick={() => setCaptionPos("low")}>Bawah</Chip>
                    <Chip small active={captionPos === "mid"} onClick={() => setCaptionPos("mid")}>Tengah</Chip>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {mode === "ad"
              ? <Toggle on={music} onChange={setMusic}>Muzik latar</Toggle>
              : <Toggle on={editMusic} onChange={setEditMusic}>Tambah muzik latar</Toggle>}
            <Toggle on={sfx} onChange={setSfx}>Sound effect</Toggle>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
              Warna tema
              <input type="color" value={accent || "#a855f7"} onChange={(e) => setAccent(e.target.value)} className="w-6 h-6 rounded cursor-pointer bg-transparent" />
              {accent ? <button type="button" onClick={() => setAccent("")} className="underline text-[10px]">auto</button> : <span className="text-[10px] text-[var(--color-text-muted)]">auto (AI pilih)</span>}
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-xs font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.35)" }}>{error}</div>
        )}
        {notice && !error && (
          <div className="mt-4 text-xs font-bold px-3 py-2 rounded-lg" style={{ background: THEME.faint, color: "var(--color-text-primary)", border: `1px solid ${THEME.soft}` }}>{notice}</div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={submitting || imgBusy || (mode === "edit" && videos.length === 0)}
            onClick={mode === "ad" ? submitAd : submitEdit}
            className="px-5 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50 inline-flex items-center gap-2"
            style={{ background: THEME.gradient, boxShadow: `0 6px 18px ${THEME.soft}` }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {submitting ? "Menghantar…" : mode === "ad" ? (variations > 1 ? `Jana ${variations} Iklan` : "Jana Iklan") : videos.length > 1 ? `Edit ${videos.length} Video` : "Edit Video"}
          </button>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {rate === null
              ? "…"
              : mode === "ad"
                ? `Anggaran RM${(adCost ?? 0).toFixed(2)} (${variations} × ~${seconds + 2}s × RM${rate.toFixed(2)}/s). Caj ikut tempoh sebenar.`
                : editCost !== null
                  ? `Anggaran RM${editCost.toFixed(2)} (${editSec}s × RM${rate.toFixed(2)}/s). Caj ikut tempoh selepas potong senyap.`
                  : `RM${rate.toFixed(2)} sesaat video`}
          </span>
        </div>
      </div>

      {visibleJobs.length > 0 && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-card)" }}>
          <div className={label}>Kerja berjalan &amp; terkini ({visibleJobs.filter((j) => j.status === "pending").length} berjalan)</div>
          {visibleJobs.map((j) => {
            const pending = j.status === "pending";
            const done = j.status === "done";
            const stage = STAGE_LABEL[String(j.stage || "queued")] || String(j.stage || "");
            const pct = done ? 100 : Math.max(3, Math.min(99, Number(j.pct) || (j.stage === "script" ? 8 : j.stage === "voice" ? 18 : 3)));
            return (
              <div key={j.id} className="flex gap-3 items-center">
                <div className="w-14 h-24 rounded-lg overflow-hidden bg-black flex-shrink-0 flex items-center justify-center">
                  {done && j.output_url ? (
                    <video src={j.output_url} poster={j.poster_url || undefined} className="w-full h-full object-cover" muted playsInline />
                  ) : pending ? (
                    <Loader2 className="w-5 h-5 animate-spin text-white/70" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-[var(--color-text-primary)] flex items-center gap-1.5">
                    {done ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : null}
                    <span className="truncate">{j.label || (j.feature === "motion-edit" ? "Edit Video" : "Iklan")}</span>
                    <span className="font-bold text-[var(--color-text-secondary)]">· {done ? `Siap · RM${(j.cost || 0).toFixed(2)}` : pending ? stage : "Gagal (kredit dipulangkan)"}</span>
                  </div>
                  {pending && (
                    <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                      <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: THEME.gradient }} />
                    </div>
                  )}
                  {!pending && !done && j.error && <div className="text-[10px] text-red-400 mt-1 line-clamp-2">{j.error}</div>}
                  {done && j.output_url && (
                    <a href={j.output_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold mt-1" style={{ color: THEME.primary }}>
                      <Download className="w-3 h-3" /> Buka / muat turun
                    </a>
                  )}
                </div>
                {!pending && (
                  <button type="button" onClick={() => dismissJob(j.id)} className="p-1 rounded hover:bg-black/10" aria-label="Tutup">
                    <X className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-[var(--color-text-muted)] text-center">Animated emoji: Google Noto Emoji Animation (CC BY 4.0). Sound effects: Kenney &amp; Freesound (CC0).</p>
    </div>
  );
}
