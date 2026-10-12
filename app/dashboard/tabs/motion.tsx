"use client";

// Motion tab — AI motion-graphics videos (Remotion on Modal).
//   🎬 Buat Iklan  — product brief → AI script + storyboard → voice → animated ad (1–3 variations)
//   ✂️ Edit Video  — client's own videos (up to 5 at once) → jump cuts, hook, word-synced
//                    stickers, Google B-roll + fact cards, face zooms, captions, SFX
// Every job runs on the server in the background (closing the tab is fine);
// each running job shows as a live placeholder card in the Motion history grid
// below (stage + progress, sections/motion-progress.tsx), which turns into the
// finished video with its guideline summary.

import { useEffect, useState } from "react";
import { Clapperboard, Loader2, Upload, X, Sparkles, Scissors, Brain, Wand2, ShieldCheck } from "lucide-react";
import { uploadImage } from "@/lib/upload-image";
import { MOTION_AD_PRESETS, MOTION_EDIT_PRESETS, type MotionPreset } from "@/lib/motion-prompts";

type Mode = "ad" | "edit";
type CaptionStyle = "pop" | "karaoke" | "box" | "tiktok";
type VideoPick = { key: string; file: File; dur: number; preview: string; uploadedUrl?: string; pct?: number | null; error?: string | null };

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };
const MAX_VIDEOS = 5;
const MAX_EDIT_IMAGES = 5;
const MAX_SEC = 180;

const VOICES = [
  { key: "mira", label: "Mira", g: "♀" },
  { key: "afifah", label: "Afifah", g: "♀" },
  { key: "nana", label: "Nana", g: "♀" },
  { key: "mila", label: "Mila", g: "♀" },
  { key: "jamal", label: "Jamal", g: "♂" },
  { key: "aqil", label: "Aqil", g: "♂" },
];

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

// "Check Guideline TikTok" — sits right before the product field in both modes.
function GuardBox({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex gap-3 items-start p-3 rounded-xl cursor-pointer"
      style={{ background: on ? "rgba(34,197,94,0.08)" : "var(--color-bg)", border: `1px solid ${on ? "rgba(34,197,94,0.55)" : "var(--color-border)"}` }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-green-500 cursor-pointer" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--color-text-primary)]">
          <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Check Guideline TikTok
        </span>
        <span className="block text-[10px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">
          AI buang claim yang langgar polisi TikTok Shop Malaysia 2026 &amp; Akta Iklan Ubat: istilah penyakit / perubatan pada kotak ditampal
          (macam salotape), ayat claim dipotong, perkataan berisiko di-mute &amp; caption ditutup, sticker / gambar B-roll disemak.
        </span>
        {on && (
          <span className="block text-[10px] mt-1 leading-snug" style={{ color: "#f59e0b" }}>
            Ini membuang claim — bukan menyorok produk. Alat perubatan / patch, produk untuk penyakit (cth. diabetes) &amp; produk kurus memang
            &quot;unsupported / prohibited&quot; di TikTok Shop MY walaupun videonya bersih — AI akan beri amaran jika produk anda berisiko.
          </span>
        )}
      </span>
    </label>
  );
}

// iOS Safari never loads metadata for a detached <video> (and ignores
// preload): attach it off-screen, muted + inline, call load(), accept
// whichever of loadedmetadata / durationchange brings a real duration, and
// give up after 12 s instead of leaving the picker hanging.
const readDuration = (url: string) =>
  new Promise<number>((resolve) => {
    const v = document.createElement("video");
    let done = false;
    const finish = (d: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.remove();
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const timer = setTimeout(() => finish(v.duration), 12_000);
    const check = () => { if (Number.isFinite(v.duration) && v.duration > 0) finish(v.duration); };
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    v.onloadedmetadata = check;
    v.ondurationchange = check;
    v.onerror = () => finish(0);
    document.body.appendChild(v);
    v.src = url;
    v.load();
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
  // TikTok guideline check — on by default, the client's choice is remembered.
  const [guard, setGuardState] = useState(true);
  useEffect(() => {
    try { const v = localStorage.getItem("motion:guard"); if (v !== null) setGuardState(v === "1"); } catch { /* storage blocked */ }
  }, []);
  const setGuard = (v: boolean) => {
    setGuardState(v);
    try { localStorage.setItem("motion:guard", v ? "1" : "0"); } catch { /* storage blocked */ }
  };
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
  const [editImages, setEditImages] = useState<string[]>([]);
  const [readingVideos, setReadingVideos] = useState(false);

  // Running jobs live in the History grid (placeholder cards poll their own status).
  // A client may have "Buat Iklan" switched off (profiles.settings.hidden_modes).
  const [adAllowed, setAdAllowed] = useState(true);
  useEffect(() => {
    fetch("/api/motion/rate").then((r) => r.json()).then((d) => {
      setRate(Number(d?.rate) || 0);
      setBrain(d?.brain || null);
      if (d?.modes?.ad === false) { setAdAllowed(false); setMode("edit"); }
    }).catch(() => setRate(0));
  }, [projectId]);

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
  // Edit Video: the seller's own product photos — every product B-roll shot comes from these.
  async function addEditImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setImgBusy(true);
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, MAX_EDIT_IMAGES - editImages.length))) {
        const r = await uploadImage(f);
        setEditImages((cur) => (cur.includes(r.url) ? cur : [...cur, r.url].slice(0, MAX_EDIT_IMAGES)));
      }
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Upload gambar gagal");
    } finally {
      setImgBusy(false);
    }
  }

  // ── videos ──
  async function addVideos(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const files = Array.from(list); // copy now — the input is cleared right after
    const room = MAX_VIDEOS - videos.length;
    const picked: VideoPick[] = [];
    setReadingVideos(true);
    try {
      for (const f of files.slice(0, room)) {
        if (f.size > 300 * 1024 * 1024) { setError(`${f.name}: terlalu besar (maks 300MB).`); continue; }
        const preview = URL.createObjectURL(f);
        const dur = await readDuration(preview);
        if (!(dur > 0.5)) { setError(`${f.name}: video tidak boleh dibaca — cuba MP4.`); URL.revokeObjectURL(preview); continue; }
        picked.push({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, dur, preview });
      }
    } finally {
      setReadingVideos(false);
    }
    setVideos((cur) => [...cur, ...picked].slice(0, MAX_VIDEOS));
    if (files.length > room) setNotice(`Maksimum ${MAX_VIDEOS} video sekali hantar.`);
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
          style, resolution, variations, guard,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
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
    if (editImages.length === 0) return setError("Upload sekurang-kurangnya 1 gambar produk.");
    setSubmitting(true);
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
              product_images: editImages,
              captions, caption_style: captionStyle, caption_pos: captionPos, music: editMusic, sfx,
              accent: accent || undefined, project_id: projectId, style, resolution, jumpcut, broll, facts, guard,
            }),
          });
          const d = await r.json();
          if (!r.ok || !d?.ok) throw new Error(d?.error || "Gagal hantar");
          removeVideo(v.key);
          // its placeholder (live progress) shows up in History right away
          window.dispatchEvent(new CustomEvent("history:refresh"));
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
    setSubmitting(false);
  }

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

        {adAllowed && (
          <div className="grid grid-cols-2 gap-2 mb-5">
            <Chip active={mode === "edit"} onClick={() => setMode("edit")}><Scissors className="inline w-3.5 h-3.5 mr-1" />Edit Video</Chip>
            <Chip active={mode === "ad"} onClick={() => setMode("ad")}><Sparkles className="inline w-3.5 h-3.5 mr-1" />Buat Iklan</Chip>
          </div>
        )}

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
                  <label className="relative overflow-hidden w-28 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed cursor-pointer text-[11px] font-bold text-center px-2"
                    style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)", aspectRatio: "9/16" }}>
                    {readingVideos ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: THEME.primary }} /> : <Upload className="w-5 h-5" style={{ color: THEME.primary }} />}
                    {readingVideos ? "Membaca video…" : videos.length ? "Tambah video" : "Pilih video (boleh banyak)"}
                    <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      onChange={(e) => { addVideos(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>
            <PromptBox value={editPrompt} onChange={setEditPrompt} presets={presets} placeholder="cth. Jadikan video jualan beg kuning: hook kuat, tick setiap kelebihan, tutup dengan CTA tekan beg kuning." />
            <GuardBox on={guard} onChange={setGuard} />
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
            <div>
              <label className={label}>Gambar produk * (1–{MAX_EDIT_IMAGES})</label>
              <div className="flex flex-wrap gap-2 items-center">
                {editImages.map((url, i) => (
                  <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border" style={{ borderColor: THEME.soft, background: "#000" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center font-bold text-white" style={{ background: "rgba(0,0,0,0.6)" }}>Produk {i + 1}</span>
                    <button type="button" onClick={() => setEditImages((cur) => cur.filter((x) => x !== url))} className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                {editImages.length < MAX_EDIT_IMAGES && (
                  <label className="relative overflow-hidden w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer" style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
                    {imgBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Produk
                    <input type="file" accept="image/*" multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => { addEditImages(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              <p className="text-[11px] mt-1 text-[var(--color-text-muted)]">
                Wajib — gambar produk anda sendiri (kotak, produk, cara guna). Gambar kotak / produk dalam video diambil dari sini sahaja, tiada gambar jenama lain. Gambar umum (cth. tampal di bahu) auto cari Google tanpa jenama.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle on={jumpcut} onChange={setJumpcut}>✂️ Buang senyap & &quot;erm&quot;</Toggle>
              <Toggle on={broll} onChange={setBroll}>🖼️ Gambar B-roll</Toggle>
              <Toggle on={facts} onChange={setFacts}>💡 Fakta Google</Toggle>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <GuardBox on={guard} onChange={setGuard} />
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
                  <label className="relative overflow-hidden w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer" style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
                    {imgBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Produk
                    <input type="file" accept="image/*" multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => { addImages(e.target.files, "product"); e.target.value = ""; }} />
                  </label>
                )}
                {!images.some((i) => i.role === "presenter") && (
                  <label className="relative overflow-hidden w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer" style={{ borderColor: "rgba(236,72,153,0.45)", color: "var(--color-text-secondary)" }}>
                    {imgBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Presenter
                    <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => { addImages(e.target.files, "presenter"); e.target.value = ""; }} />
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
                <Chip small active={captionStyle === "tiktok"} onClick={() => setCaptionStyle("tiktok")}>TikTok</Chip>
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
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] ml-1">Warna tema</span>
            <Chip small active={!accent} onClick={() => setAccent("")}>✨ AI pilih</Chip>
            {/* the native colour picker sits over the chip (works on phones too) */}
            <label className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
              style={{ background: accent ? THEME.faint : "var(--color-bg)", border: `1px solid ${accent ? THEME.primary : "var(--color-border)"}`, color: "var(--color-text-primary)" }}>
              <span className="w-4 h-4 rounded-full border border-white/40"
                style={{ background: accent || "conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)" }} />
              {accent ? accent.toUpperCase() : "Pilih warna"}
              <input type="color" value={accent || "#a855f7"} onChange={(e) => setAccent(e.target.value)} aria-label="Pilih warna tema"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
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

      <p className="text-[10px] text-[var(--color-text-muted)] text-center">Animated emoji: Google Noto Emoji Animation (CC BY 4.0). Sound effects: Kenney &amp; Freesound (CC0).</p>
    </div>
  );
}
