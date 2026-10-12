"use client";

// The seller's product photos for Motion Edit Video (1–5) — shared by the Edit
// Video form and the History card's Resubmit box. Every product B-roll shot
// comes from these. Upload goes browser → Modal → B2 (signed URL, retried on a
// dropped connection); each photo can be taped (🩹) before use; the client's
// gallery (/api/motion/photos) lets them reuse or delete earlier photos. A
// photo that no longer loads (deleted from storage) drops out by itself, so
// the client is asked to upload again.

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Loader2, Trash2, Upload, X } from "lucide-react";
import { compressImageIfNeeded } from "@/lib/compress-image";
import MotionTapeEditor from "./motion-tape-editor";

export const MAX_PRODUCT_PHOTOS = 5;
const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)" };

/** Up to 3 tries, 1.5 s / 3 s apart, for errors marked `retry` (network drop, 5xx). */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (k >= tries || !(e as { retry?: boolean })?.retry) throw e;
      await new Promise((r) => setTimeout(r, 1500 * k));
    }
  }
}

/** Same browser → Modal → B2 path as the video, so it doesn't depend on a third-party image host. */
export async function uploadProductPhoto(input: File): Promise<string> {
  const { file } = await compressImageIfNeeded(input);
  const r = await fetch("/api/motion/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, kind: "image" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.upload_url) throw new Error(d?.error || "Tak dapat link upload");
  return withRetry(async () => {
    const up = await fetch(d.upload_url, { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file })
      .catch(() => { throw Object.assign(new Error("Upload gagal — semak sambungan internet."), { retry: true }); });
    const j = await up.json().catch(() => ({}));
    if (!up.ok || !j?.url) throw Object.assign(new Error(j?.error || `Upload gagal (${up.status})`), { retry: up.status >= 500 });
    return String(j.url);
  });
}

type Photo = { id: string; url: string };

export default function MotionPhotoPicker({ value, onChange, disabled, onBusyChange }: {
  value: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(0);
  const [tapeSrc, setTapeSrc] = useState<string | null>(null);
  const [gallery, setGallery] = useState<Photo[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange?.(b); };

  useEffect(() => {
    fetch("/api/motion/photos").then((r) => r.json()).then((d) => setGallery(Array.isArray(d?.photos) ? d.photos : [])).catch(() => undefined);
  }, []);

  const remember = (url: string) =>
    fetch("/api/motion/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
      .then((r) => r.json()).then((d) => { if (d?.photo) setGallery((g) => [d.photo, ...g.filter((p) => p.url !== url)]); })
      .catch(() => undefined);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files); // copy now — the input is cleared right after
    setError(null);
    setBusy(true);
    try {
      for (const f of picked.slice(0, Math.max(0, MAX_PRODUCT_PHOTOS - value.length))) {
        const url = await uploadProductPhoto(f);
        onChange((cur) => (cur.includes(url) ? cur : [...cur, url].slice(0, MAX_PRODUCT_PHOTOS)));
        void remember(url); // the gallery, for the next video (best-effort)
      }
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? `Upload gambar gagal: ${e.message}` : "Upload gambar gagal");
    } finally {
      setBusy(false);
    }
  }

  // taped photo → uploaded as a new photo that takes the original's place
  async function saveTaped(original: string, file: File) {
    const url = await uploadProductPhoto(file);
    onChange((cur) => cur.map((u) => (u === original ? url : u)));
    void remember(url);
    setTapeSrc(null);
  }

  const toggle = (url: string) => onChange((cur) =>
    cur.includes(url) ? cur.filter((x) => x !== url) : cur.length >= MAX_PRODUCT_PHOTOS ? cur : [...cur, url]);

  async function forget(p: Photo) {
    setGallery((g) => g.filter((x) => x.id !== p.id));
    onChange((cur) => cur.filter((x) => x !== p.url));
    await fetch(`/api/motion/photos?id=${encodeURIComponent(p.id)}`, { method: "DELETE" }).catch(() => undefined);
  }

  // a selected photo whose file is gone: drop it so the client uploads again
  const lost = (url: string) => {
    onChange((cur) => cur.filter((x) => x !== url));
    setMissing((n) => n + 1);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {value.map((url, i) => (
          <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border" style={{ borderColor: THEME.soft, background: "#000" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" onError={() => lost(url)} />
            <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center font-bold text-white" style={{ background: "rgba(0,0,0,0.6)" }}>Produk {i + 1}</span>
            <button type="button" onClick={() => onChange((cur) => cur.filter((x) => x !== url))} disabled={disabled}
              className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5 disabled:opacity-40" aria-label="Buang gambar">
              <X className="w-3 h-3 text-white" />
            </button>
            <button type="button" onClick={() => setTapeSrc(url)} disabled={disabled} title="Tampal tulisan pada gambar" aria-label="Tampal"
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] leading-none disabled:opacity-40"
              style={{ background: "rgba(168,85,247,0.9)" }}>
              🩹
            </button>
          </div>
        ))}
        {value.length < MAX_PRODUCT_PHOTOS && (
          <label className="relative overflow-hidden w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer"
            style={{ borderColor: THEME.soft, color: "var(--color-text-secondary)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Produk
            <input type="file" accept="image/*" multiple disabled={disabled || busy} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {missing > 0 && value.length === 0 && (
        <p className="text-[11px] mt-1 font-bold" style={{ color: "#f59e0b" }}>Gambar produk lama sudah tiada — sila upload semula.</p>
      )}
      {error && <p className="text-[11px] mt-1 font-bold text-red-400">{error}</p>}
      {value.length > 0 && (
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Tekan 🩹 pada gambar untuk tampal tulisan (cth. claim) sebelum edit.</p>
      )}
      {tapeSrc && (
        <MotionTapeEditor src={tapeSrc} onClose={() => setTapeSrc(null)} onSave={(f) => saveTaped(tapeSrc, f)} />
      )}
      {gallery.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowGallery((s) => !s)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
            style={{ background: THEME.faint, border: `1px solid ${THEME.soft}`, color: "var(--color-text-primary)" }}>
            🖼️ Guna gambar lama ({gallery.length}) {showGallery ? "▲" : "▼"}
          </button>
          {showGallery && (
            <div className="mt-2 p-2 rounded-xl grid grid-cols-4 sm:grid-cols-6 gap-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
              {gallery.map((p) => {
                const on = value.includes(p.url);
                return (
                  <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer"
                    style={{ borderColor: on ? THEME.primary : "transparent", background: "#000" }}
                    onClick={() => !disabled && toggle(p.url)} title={on ? "Buang dari video ni" : "Guna dalam video ni"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy"
                      onError={() => setGallery((g) => g.filter((x) => x.id !== p.id))} />
                    {on && <span className="absolute top-0.5 left-0.5 rounded-full px-1 text-[10px] font-extrabold text-white" style={{ background: THEME.primary }}>✓</span>}
                    <button type="button" aria-label="Padam gambar"
                      onClick={(e) => { e.stopPropagation(); void forget(p); }}
                      className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-1">
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
