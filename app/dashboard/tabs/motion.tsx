"use client";

// Motion tab — AI motion-graphics videos (Remotion on Modal).
//   🎬 Buat Iklan  — product brief → AI script + storyboard → voice → animated ad
//   ✂️ Edit Video  — client's own video → captions, word-synced stickers, zooms
// Jobs are tracked live here (/api/motion/status) and land in the Motion
// history grid below when done.

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Loader2, Upload, X, Download, Sparkles, Scissors, CheckCircle2, AlertTriangle } from "lucide-react";
import { uploadImage } from "@/lib/upload-image";

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
};

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };

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
  normalise: "Sediakan video",
  transcribe: "Transkrip suara",
  plan: "AI rancang animasi",
  render: "Render animasi",
  upload: "Upload video siap",
  done: "Siap",
  failed: "Gagal",
};

const label = "block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none";
const inputStyle = { border: `1px solid ${THEME.soft}`, color: "var(--color-text)" } as const;

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-2 rounded-xl text-xs font-extrabold transition-all disabled:opacity-50"
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

const jobsKey = (projectId?: string) => `motion-jobs:${projectId || "none"}`;
const loadJobIds = (projectId?: string): string[] => {
  try { return JSON.parse(localStorage.getItem(jobsKey(projectId)) || "[]").slice(0, 8); } catch { return []; }
};
const saveJobIds = (projectId: string | undefined, ids: string[]) => {
  try { localStorage.setItem(jobsKey(projectId), JSON.stringify(ids.slice(0, 8))); } catch { /* storage blocked */ }
};

export default function MotionTab({ projectId }: { projectId?: string }) {
  const [mode, setMode] = useState<Mode>("ad");
  const [rate, setRate] = useState<number | null>(null);

  // shared
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("pop");
  const [sfx, setSfx] = useState(true);
  const [accent, setAccent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Buat Iklan
  const [product, setProduct] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [cta, setCta] = useState("");
  const [handle, setHandle] = useState("");
  const [vibe, setVibe] = useState("");
  const [extra, setExtra] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [voice, setVoice] = useState("mira");
  const [language, setLanguage] = useState<"ms" | "en">("ms");
  const [music, setMusic] = useState(true);
  const [images, setImages] = useState<{ url: string; role: "product" | "presenter" }[]>([]);
  const [imgBusy, setImgBusy] = useState(false);

  // Edit Video
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDur, setVideoDur] = useState(0);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [editLang, setEditLang] = useState<"ms" | "en" | "auto">("ms");
  const [captionPos, setCaptionPos] = useState<"low" | "mid">("low");
  const [editMusic, setEditMusic] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [context, setContext] = useState("");
  const previewRef = useRef<string | null>(null);

  // jobs
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const lastStatus = useRef<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/motion/rate").then((r) => r.json()).then((d) => setRate(Number(d?.rate) || 0)).catch(() => setRate(0));
    setJobIds(loadJobIds(projectId));
  }, [projectId]);

  // live job polling
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
          next[j.id] = j;
          if (j.status !== "pending" && lastStatus.current[j.id] === "pending") justFinished = true;
          lastStatus.current[j.id] = j.status;
        }
        setJobs(next);
        if (justFinished) window.dispatchEvent(new CustomEvent("history:refresh"));
        const anyPending = Object.values(next).some((j) => j.status === "pending");
        if (anyPending) timer = setTimeout(tick, 5000);
      } catch {
        if (!stop) timer = setTimeout(tick, 8000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobIds]);

  const addJob = (id: string) => {
    const ids = [id, ...jobIds.filter((x) => x !== id)].slice(0, 8);
    setJobIds(ids);
    saveJobIds(projectId, ids);
    lastStatus.current[id] = "pending";
    setJobs((j) => ({ ...j, [id]: { id, status: "pending", stage: "queued" } }));
  };
  const dismissJob = (id: string) => {
    const ids = jobIds.filter((x) => x !== id);
    setJobIds(ids);
    saveJobIds(projectId, ids);
  };

  const adCost = rate !== null ? Math.ceil(seconds + 2) * rate : null;
  const editCost = rate !== null && videoDur > 0 ? Math.ceil(Math.min(videoDur, 180)) * rate : null;

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

  // ── video ──
  function pickVideo(f: File | null) {
    setError(null);
    setVideoUrl(null);
    setUploadPct(null);
    setVideoDur(0);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setVideoFile(f);
    if (!f) return;
    if (f.size > 300 * 1024 * 1024) { setError("Video terlalu besar (maks 300MB)."); setVideoFile(null); return; }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => setVideoDur(v.duration || 0);
    v.onerror = () => setError("Video tidak boleh dibaca — cuba MP4.");
    v.src = url;
  }

  async function uploadVideo(f: File): Promise<string> {
    const r = await fetch("/api/motion/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, size: f.size }),
    });
    const d = await r.json();
    if (!r.ok || !d?.upload_url) throw new Error(d?.error || "Tak dapat link upload");
    return await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", d.upload_url);
      xhr.setRequestHeader("Content-Type", f.type || "video/mp4");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        try {
          const j = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && j?.url) resolve(j.url);
          else reject(new Error(j?.error || `Upload gagal (${xhr.status})`));
        } catch { reject(new Error(`Upload gagal (${xhr.status})`)); }
      };
      xhr.onerror = () => reject(new Error("Upload gagal — semak sambungan internet."));
      xhr.send(f);
    });
  }

  // ── submit ──
  async function submitAd() {
    setError(null);
    if (!product.trim()) return setError("Isi nama produk.");
    if (description.trim().length < 10) return setError("Terangkan produk sekurang-kurangnya satu ayat.");
    setSubmitting(true);
    try {
      const r = await fetch("/api/motion/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product, description, price, old_price: oldPrice, cta, handle, vibe, extra, seconds, voice, language,
          captions, caption_style: captionStyle, music, sfx, accent: accent || undefined, images, project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
      addJob(d.id);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit() {
    setError(null);
    if (!videoFile) return setError("Pilih video dahulu.");
    if (!(videoDur > 0.5)) return setError("Tempoh video belum dibaca — tunggu sekejap.");
    setSubmitting(true);
    try {
      let url = videoUrl;
      if (!url) {
        url = await uploadVideo(videoFile);
        setVideoUrl(url);
      }
      const r = await fetch("/api/motion/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: url, duration_sec: videoDur, language: editLang, instructions, product: context,
          captions, caption_style: captionStyle, caption_pos: captionPos, music: editMusic, sfx,
          accent: accent || undefined, project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
      addJob(d.id);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  }

  const visibleJobs = useMemo(() => jobIds.map((id) => jobs[id]).filter(Boolean) as Job[], [jobIds, jobs]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 border" style={{ background: `linear-gradient(135deg, ${THEME.faint}, transparent)`, borderColor: THEME.soft }}>
        <div className="flex items-center gap-2 mb-1">
          <Clapperboard className="w-5 h-5" style={{ color: THEME.primary }} strokeWidth={2.4} />
          <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">Motion</h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Video motion-graphic macam editor pro — AI tulis skrip, susun animasi, sticker, caption & muzik yang
          sync dengan setiap perkataan. Buat iklan dari kosong, atau upload video anda untuk diedit.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          <Chip active={mode === "ad"} onClick={() => setMode("ad")}><Sparkles className="inline w-3.5 h-3.5 mr-1" />Buat Iklan</Chip>
          <Chip active={mode === "edit"} onClick={() => setMode("edit")}><Scissors className="inline w-3.5 h-3.5 mr-1" />Edit Video</Chip>
        </div>

        {mode === "ad" ? (
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
                <input className={inputCls} style={inputStyle} value={cta} maxLength={40} onChange={(e) => setCta(e.target.value)} placeholder="Order di TikTok Shop" />
              </div>
            </div>

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

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Tempoh</label>
                <div className="flex gap-2">
                  {[15, 30, 45].map((s) => <Chip key={s} active={seconds === s} onClick={() => setSeconds(s)}>{s}s</Chip>)}
                </div>
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
              <div className="flex flex-wrap gap-2">
                {VOICES.map((v) => <Chip key={v.key} active={voice === v.key} onClick={() => setVoice(v.key)}>{v.g} {v.label}</Chip>)}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Gaya / mood (optional)</label>
                <input className={inputCls} style={inputStyle} value={vibe} maxLength={80} onChange={(e) => setVibe(e.target.value)} placeholder="cth. kelakar, mewah, urgent promo" />
              </div>
              <div>
                <label className={label}>Arahan tambahan (optional)</label>
                <input className={inputCls} style={inputStyle} value={extra} maxLength={500} onChange={(e) => setExtra(e.target.value)} placeholder="cth. tekankan free postage" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={label}>Video anda * (maks 3 minit · 300MB)</label>
              {!videoFile ? (
                <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 cursor-pointer text-xs font-bold" style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
                  <Upload className="w-6 h-6" style={{ color: THEME.primary }} />
                  Klik untuk pilih video (MP4 / MOV)
                  <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v" className="hidden" onChange={(e) => pickVideo(e.target.files?.[0] || null)} />
                </label>
              ) : (
                <div className="flex gap-3 items-start">
                  <video src={previewRef.current || undefined} className="w-28 rounded-lg bg-black" style={{ aspectRatio: "9/16", objectFit: "cover" }} muted playsInline controls />
                  <div className="text-xs space-y-1 text-[var(--color-text-secondary)]">
                    <div className="font-bold text-[var(--color-text-primary)] break-all">{videoFile.name}</div>
                    <div>{(videoFile.size / 1024 / 1024).toFixed(1)} MB · {videoDur > 0 ? `${videoDur.toFixed(1)}s` : "membaca…"}</div>
                    {videoDur > 180 && <div style={{ color: "#f59e0b" }}>Hanya 3 minit pertama akan diedit.</div>}
                    {uploadPct !== null && <div>Upload {uploadPct}%</div>}
                    <button type="button" onClick={() => pickVideo(null)} className="underline">Tukar video</button>
                  </div>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Bahasa dalam video</label>
                <div className="flex gap-2">
                  <Chip active={editLang === "ms"} onClick={() => setEditLang("ms")}>Melayu</Chip>
                  <Chip active={editLang === "en"} onClick={() => setEditLang("en")}>English</Chip>
                  <Chip active={editLang === "auto"} onClick={() => setEditLang("auto")}>Auto</Chip>
                </div>
              </div>
              <div>
                <label className={label}>Kedudukan caption</label>
                <div className="flex gap-2">
                  <Chip active={captionPos === "low"} onClick={() => setCaptionPos("low")}>Bawah</Chip>
                  <Chip active={captionPos === "mid"} onClick={() => setCaptionPos("mid")}>Tengah</Chip>
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Produk / konteks (optional)</label>
                <input className={inputCls} style={inputStyle} value={context} maxLength={300} onChange={(e) => setContext(e.target.value)} placeholder="cth. Serum vitamin C, RM39" />
              </div>
              <div>
                <label className={label}>Arahan edit (optional)</label>
                <input className={inputCls} style={inputStyle} value={instructions} maxLength={600} onChange={(e) => setInstructions(e.target.value)} placeholder="cth. highlight harga & 3 kelebihan" />
              </div>
            </div>
          </div>
        )}

        {/* shared style controls */}
        <div className="mt-5 pt-4 border-t space-y-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex flex-wrap gap-2 items-center">
            <span className={`${label} !mb-0 mr-1`}>Caption</span>
            <Chip active={captions && captionStyle === "pop"} onClick={() => { setCaptions(true); setCaptionStyle("pop"); }}>Pop</Chip>
            <Chip active={captions && captionStyle === "karaoke"} onClick={() => { setCaptions(true); setCaptionStyle("karaoke"); }}>Karaoke</Chip>
            <Chip active={captions && captionStyle === "box"} onClick={() => { setCaptions(true); setCaptionStyle("box"); }}>Box</Chip>
            <Chip active={!captions} onClick={() => setCaptions(false)}>Tiada</Chip>
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
          <div className="mt-4 text-xs font-bold px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.35)" }}>
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={submitting || imgBusy || (mode === "edit" && (!videoFile || !(videoDur > 0.5)))}
            onClick={mode === "ad" ? submitAd : submitEdit}
            className="px-5 py-3 rounded-xl text-sm font-extrabold text-white disabled:opacity-50 inline-flex items-center gap-2"
            style={{ background: THEME.gradient, boxShadow: `0 6px 18px ${THEME.soft}` }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
            {submitting ? (mode === "edit" && uploadPct !== null ? `Upload ${uploadPct}%…` : "Menghantar…") : mode === "ad" ? "Jana Iklan" : "Edit Video"}
          </button>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {rate === null
              ? "…"
              : mode === "ad"
                ? `Anggaran RM${(adCost ?? 0).toFixed(2)} (~${seconds + 2}s × RM${rate.toFixed(2)}/s). Caj ikut tempoh sebenar.`
                : editCost !== null
                  ? `Anggaran RM${editCost.toFixed(2)} (${Math.ceil(Math.min(videoDur, 180))}s × RM${rate.toFixed(2)}/s)`
                  : `RM${rate.toFixed(2)} sesaat video`}
          </span>
        </div>
      </div>

      {visibleJobs.length > 0 && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-card)" }}>
          <div className={label}>Kerja terkini</div>
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
                    {j.feature === "motion-edit" ? "Edit Video" : "Iklan"} · {done ? `Siap · RM${(j.cost || 0).toFixed(2)}` : pending ? stage : "Gagal (kredit dipulangkan)"}
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
    </div>
  );
}
