"use client";

// Product-photo tape editor (Edit Video): the client drags strips of tape over
// whatever they want hidden on their own photo (claims, other brands…), then
// saves — the taped photo is uploaded as a new photo and used for the edit.
// The photo is fetched as a blob (B2 sends CORS for the site) so the canvas
// stays exportable. Works with mouse and touch (iPhone): pointer events +
// touch-action none on the canvas.

import { useEffect, useRef, useState } from "react";
import { Loader2, Undo2, Trash2, X } from "lucide-react";
import Portal from "../sections/portal";

type Tape = { x: number; y: number; w: number; h: number; color: string };

const COLORS = [
  { v: "#eadfc4", label: "Krim" },
  { v: "#f7f7f4", label: "Putih" },
  { v: "#1f1f1f", label: "Hitam" },
];
const MAX_SIDE = 2000; // longest side of the saved photo

/** Masking-tape strip: torn (zig-zag) short ends, soft shadow, faint grain. */
function drawTape(ctx: CanvasRenderingContext2D, t: Tape) {
  const { x, y, w, h } = t;
  const steps = Math.max(4, Math.round(h / 9)) * 2;
  const depth = Math.min(w * 0.08, Math.max(3, h * 0.12));
  const path = new Path2D();
  path.moveTo(x, y);
  path.lineTo(x + w, y);
  for (let k = 1; k <= steps; k++) path.lineTo(x + w - (k % 2 ? depth : 0), y + (h * k) / steps);
  path.lineTo(x, y + h);
  for (let k = steps - 1; k >= 1; k--) path.lineTo(x + (k % 2 ? depth : 0), y + (h * k) / steps);
  path.closePath();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = Math.max(2, h * 0.08);
  ctx.shadowOffsetY = Math.max(1, h * 0.03);
  ctx.fillStyle = t.color;
  ctx.fill(path);
  ctx.shadowColor = "transparent";
  ctx.clip(path);
  ctx.strokeStyle = t.color === "#1f1f1f" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  ctx.lineWidth = Math.max(1, h * 0.02);
  for (let k = 1; k < 6; k++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (h * k) / 6);
    ctx.lineTo(x + w, y + (h * k) / 6);
    ctx.stroke();
  }
  ctx.restore();
}

const norm = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
});

export default function MotionTapeEditor({ src, onClose, onSave }: {
  src: string;
  onClose: () => void;
  /** Upload the taped photo; throw to show an error and keep the editor open. */
  onSave: (file: File) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [png, setPng] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tapes, setTapes] = useState<Tape[]>([]);
  const [color, setColor] = useState(COLORS[0].v);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // load the photo as a same-origin blob so the canvas can be exported
  useEffect(() => {
    let url = "";
    let alive = true;
    fetch(src, { mode: "cors", cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((blob) => {
        if (!alive) return;
        setPng(/png|webp|gif/i.test(blob.type));
        url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => alive && setImg(im);
        im.onerror = () => alive && setLoadError("Gambar tak dapat dibuka.");
        im.src = url;
      })
      .catch(() => alive && setLoadError("Gambar tak dapat dimuat — cuba lagi."));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [src]);

  // redraw: photo + saved tapes + the strip being dragged
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s);
    const h = Math.round(img.naturalHeight * s);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const t of tapes) drawTape(ctx, t);
    if (drag) {
      const r = norm(drag.a, drag.b);
      if (r.w > 2 && r.h > 2) drawTape(ctx, { ...r, color });
    }
  }, [img, tapes, drag, color]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const b = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(c.width, ((e.clientX - b.left) / b.width) * c.width)),
      y: Math.max(0, Math.min(c.height, ((e.clientY - b.top) / b.height) * c.height)),
    };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setDrag({ a: p, b: p });
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const p = point(e);
    setDrag((d) => (d ? { ...d, b: p } : d));
  };
  const onUp = () => {
    if (!drag) return;
    const r = norm(drag.a, drag.b);
    const c = canvasRef.current;
    const min = c ? Math.max(6, Math.min(c.width, c.height) * 0.012) : 6;
    if (r.w >= min && r.h >= min) setTapes((t) => [...t, { ...r, color }]);
    setDrag(null);
  };

  async function save() {
    const c = canvasRef.current;
    if (!c || !tapes.length || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const type = png ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.92));
      if (!blob) throw new Error("Gagal simpan gambar");
      await onSave(new File([blob], `tampal-${Date.now()}.${png ? "png" : "jpg"}`, { type }));
    } catch (e: unknown) {
      setSaveError(e instanceof Error && e.message ? e.message : "Gagal simpan");
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.78)" }}
        onClick={() => !saving && onClose()}>
        <div className="w-full max-w-lg rounded-2xl p-4 max-h-[95vh] overflow-y-auto"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[13px] font-extrabold text-[var(--color-text-primary)]">🩹 Tampal gambar produk</div>
            <button type="button" onClick={onClose} disabled={saving} className="ml-auto p-1 rounded-lg disabled:opacity-40" aria-label="Tutup">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mb-3 leading-snug">
            Seret jari / mouse atas tulisan yang nak ditutup (cth. claim, jenama lain). Gambar bertampal ini yang akan digunakan dalam video.
          </p>

          <div className="flex items-center justify-center rounded-xl overflow-hidden mb-3" style={{ background: "#000", minHeight: 200 }}>
            {loadError ? (
              <span className="text-[12px] font-bold text-red-400 p-6 text-center">{loadError}</span>
            ) : !img ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : null}
            <canvas
              ref={canvasRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className={img ? "block max-w-full cursor-crosshair select-none" : "hidden"}
              style={{ maxHeight: "60vh", width: "auto", height: "auto", touchAction: "none" }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)]">Warna tape</span>
            {COLORS.map((c) => (
              <button key={c.v} type="button" onClick={() => setColor(c.v)} title={c.label}
                className="w-7 h-7 rounded-full border-2"
                style={{ background: c.v, borderColor: color === c.v ? "#a855f7" : "var(--color-border)" }} />
            ))}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setTapes((t) => t.slice(0, -1))} disabled={!tapes.length || saving}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
              <button type="button" onClick={() => setTapes([])} disabled={!tapes.length || saving}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                <Trash2 className="w-3.5 h-3.5" /> Padam semua
              </button>
            </div>
          </div>

          {saveError && <p className="text-[11px] font-bold text-red-400 mb-2">{saveError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="py-2.5 rounded-xl text-[12px] font-bold disabled:opacity-40"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
              Batal
            </button>
            <button type="button" onClick={() => void save()} disabled={!tapes.length || saving}
              className="py-2.5 rounded-xl text-[12px] font-extrabold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#a855f7,#ec4899)" }}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? "Menyimpan…" : `Simpan${tapes.length ? ` (${tapes.length} tape)` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
