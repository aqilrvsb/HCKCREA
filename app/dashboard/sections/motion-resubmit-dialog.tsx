"use client";

// "Render semula" box for a Motion Edit Video job — shared by the History card
// and the admin Motion monitor. Asks for the product name and product photos
// (1–5: upload / 🩹 tape / gallery; photos no longer in storage drop out so
// they're uploaded again), then POSTs /api/motion/resubmit: the SAME card
// re-renders in place, charged like a new edit to the job's owner.

import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import Portal from "./portal";
import MotionPhotoPicker from "../tabs/motion-photo-picker";

const GREEN = "linear-gradient(135deg, #22c55e, #4ade80)";

export default function MotionResubmitDialog({ id, product: product0, images: images0, note, onClose, onDone }: {
  id: string;
  /** The job's current product name / photos (pre-filled). */
  product?: string;
  images?: string[];
  /** Extra line under the price note (e.g. who is charged, for the admin). */
  note?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [product, setProduct] = useState(String(product0 || "").slice(0, 80));
  const [images, setImages] = useState<string[]>(() => (images0 ?? []).filter((u) => /^https:\/\//.test(String(u))).slice(0, 5));
  const [imgBusy, setImgBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = !!product.trim() && images.length > 0 && !imgBusy && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await fetch("/api/motion/resubmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, product: product.replace(/\s+/g, " ").trim(), product_images: images }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        alert(d?.error || `Gagal hantar semula (HTTP ${r.status})`);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.72)" }}
        onClick={() => !busy && onClose()}>
        <div className="w-full max-w-sm rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="text-[13px] font-extrabold text-[var(--color-text-primary)] mb-1">🔁 Render semula</div>
          <div className="text-[11px] text-[var(--color-text-muted)] mb-2 leading-snug">
            Video ini akan diedit semula (tanpa tampal / mute / potong). Kad ini akan diganti dengan video baru.
          </div>
          <div className="text-[11px] font-bold mb-3" style={{ color: "#f59e0b" }}>
            Dicaj ikut tempoh video (macam edit baru).
            {note && <span className="block font-normal text-[var(--color-text-muted)] mt-0.5">{note}</span>}
          </div>
          <label className="block text-[11px] font-bold text-[var(--color-text-primary)] mb-1">
            Nama produk <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value.slice(0, 80))}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="Contoh: Minyak Herba Mak Dara"
            autoFocus
            className="w-full px-3 py-2 rounded-xl text-[12px] mb-1 outline-none"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text-primary)" }}
          />
          <div className="text-[10px] text-[var(--color-text-muted)] mb-3">Ejaan betul nama produk — AI guna untuk caption &amp; skrip.</div>
          <label className="block text-[11px] font-bold text-[var(--color-text-primary)] mb-1">
            Gambar produk <span style={{ color: "#ef4444" }}>*</span> <span className="font-normal text-[var(--color-text-muted)]">(1–5)</span>
          </label>
          <div className="mb-3">
            <MotionPhotoPicker value={images} onChange={setImages} disabled={busy} onBusyChange={setImgBusy} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} disabled={busy}
              className="py-2 rounded-xl text-[12px] font-bold disabled:opacity-40"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
              Batal
            </button>
            <button onClick={() => void submit()} disabled={!ready}
              className="py-2 rounded-xl text-[12px] font-extrabold text-white flex items-center justify-center gap-1 disabled:opacity-40"
              style={{ background: GREEN }}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              Hantar semula
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
