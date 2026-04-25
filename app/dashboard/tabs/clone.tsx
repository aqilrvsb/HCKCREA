"use client";

import { useRef, useState } from "react";
import { Layers, Sparkles, Upload, Video as VideoIcon, Loader2, X } from "lucide-react";

export default function CloneTab() {
  const [refVideoUrl, setRefVideoUrl] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [customDialog, setCustomDialog] = useState("");
  const [segments, setSegments] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchInfo, setBatchInfo] = useState<{ batch_id: string; segments: number; total_cost: number } | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);

  function onProductFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setProductImageUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (!refVideoUrl) return setError("Sila masukkan reference video URL.");
    if (!productImageUrl) return setError("Sila upload gambar produk.");
    setError(null);
    setSubmitting(true);
    setBatchInfo(null);
    try {
      const r = await fetch("/api/generate/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_video_url: refVideoUrl,
          product_image_url: productImageUrl,
          custom_dialog: customDialog,
          segments,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Failed to start clone");
        setSubmitting(false);
        return;
      }
      setBatchInfo({ batch_id: d.batch_id, segments: d.segments, total_cost: d.total_cost });
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center">
          <Layers className="w-5 h-5 text-orange" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Clone Mode</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Tiru video viral — tukar dengan produk anda</p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Reference video URL (TikTok / IG / public mp4)</label>
          <div className="relative">
            <VideoIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="url"
              value={refVideoUrl}
              onChange={(e) => setRefVideoUrl(e.target.value)}
              placeholder="https://..."
              className="input pl-11"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Gambar produk anda</label>
          <input
            ref={productInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onProductFile(e.target.files?.[0] || null)}
          />
          {productImageUrl ? (
            <div className="relative inline-block">
              <img src={productImageUrl} alt="product" className="rounded-2xl max-h-40 border border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => setProductImageUrl("")}
                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-[var(--color-border)] shadow flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => productInputRef.current?.click()}
              className="w-full p-5 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-orange-300 hover:bg-orange-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]"
            >
              <Upload className="w-5 h-5" />
              Upload product image
            </button>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Number of segments</label>
          <select className="input" value={segments} onChange={(e) => setSegments(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} segment ({n * 8}s total)</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Custom dialog <span className="text-[var(--color-text-muted)] text-xs font-normal">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={customDialog}
            onChange={(e) => setCustomDialog(e.target.value)}
            placeholder="Kalau nak overwrite dialog dari video referensi..."
            className="input resize-none"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {batchInfo && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="font-bold text-emerald-700 mb-1">Clone dah start! 🎉</div>
            <p className="text-sm text-emerald-700">
              {batchInfo.segments} segment sedang generate.
            </p>
            <div className="text-xs font-mono text-emerald-700 mt-1.5">
              Total cost: RM{batchInfo.total_cost.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <button onClick={submit} disabled={submitting} className="btn-primary w-full mt-6 disabled:opacity-60">
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Submitting…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Clone Now
          </>
        )}
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        ~RM{(segments * 0.4).toFixed(2)} ikut Pro plan rate · master plan free
      </p>
    </div>
  );
}
