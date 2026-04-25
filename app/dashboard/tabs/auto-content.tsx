"use client";

import { useRef, useState } from "react";
import {
  Wand2,
  Link as LinkIcon,
  ArrowRight,
  Loader2,
  Upload,
  X,
} from "lucide-react";

export default function AutoContentTab() {
  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [quantity, setQuantity] = useState(5);
  const [duration, setDuration] = useState<"8" | "16">("8");
  const [customCta, setCustomCta] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchInfo, setBatchInfo] = useState<{ batch_id: string; quantity: number; total_cost: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setProductImageUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (!productImageUrl && !productUrl) {
      return setError("Sila masuk product URL atau upload gambar produk.");
    }
    setError(null);
    setSubmitting(true);
    setBatchInfo(null);
    try {
      const r = await fetch("/api/generate/auto-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: productUrl,
          product_image_url: productImageUrl,
          product_name: productName,
          quantity,
          duration,
          custom_cta: customCta,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Failed to start batch");
        setSubmitting(false);
        return;
      }
      setBatchInfo({
        batch_id: d.batch_id,
        quantity: d.quantity,
        total_cost: d.total_cost,
      });
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
          <Wand2 className="w-5 h-5 text-orange" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Auto Content</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Letak link produk → 10 video UGC siap caption
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Link produk TikTok Shop</label>
          <div className="relative">
            <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="url"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://shop.tiktok.com/view/..."
              className="input pl-11"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Nama produk <span className="text-[var(--color-text-muted)] text-xs font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Serum Glow Skincare"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Gambar produk <span className="text-[var(--color-text-muted)] text-xs font-normal">(disyorkan)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          {productImageUrl ? (
            <div className="relative inline-block">
              <img src={productImageUrl} alt="ref" className="rounded-2xl max-h-40 border border-[var(--color-border)]" />
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
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-5 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-orange-300 hover:bg-orange-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]"
            >
              <Upload className="w-5 h-5" />
              Upload product image
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Kuantiti</label>
            <select
              className="input"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            >
              {[1, 3, 5, 10].map((n) => (
                <option key={n} value={n}>{n} video</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Duration</label>
            <select className="input" value={duration} onChange={(e) => setDuration(e.target.value as any)}>
              <option value="8">8 saat</option>
              <option value="16">16 saat</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Custom CTA <span className="text-[var(--color-text-muted)] text-xs font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={customCta}
            onChange={(e) => setCustomCta(e.target.value)}
            placeholder="Default: tekan beg kuning"
            className="input"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {batchInfo && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="font-bold text-emerald-700 mb-1">Batch dah start! 🎉</div>
            <p className="text-sm text-emerald-700">
              {batchInfo.quantity} video sedang generate. Check Auto Content history di kanan dalam beberapa minit.
            </p>
            <div className="text-xs font-mono text-emerald-700 mt-1.5">
              Total cost: RM{batchInfo.total_cost.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="btn-primary w-full mt-6 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating master plan…
          </>
        ) : (
          <>
            Generate {quantity} Video
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        Master plan FREE · setiap video tolak rate plan anda
      </p>
    </div>
  );
}
