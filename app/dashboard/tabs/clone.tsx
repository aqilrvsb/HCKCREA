"use client";

import { Layers, Sparkles, Upload, Video } from "lucide-react";

export default function CloneTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <Layers className="w-5 h-5 text-amber-600" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Clone Mode</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Tiru video viral — tukar dengan produk anda
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">
            Reference video (yang viral)
          </label>
          <button className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-amber-300 hover:bg-amber-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Video className="w-6 h-6" />
            Upload video referensi
            <span className="text-xs">MP4 / MOV / max 100MB</span>
          </button>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Gambar produk anda
          </label>
          <button className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-amber-300 hover:bg-amber-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Upload className="w-6 h-6" />
            Upload product image
            <span className="text-xs">PNG / JPG / max 8MB</span>
          </button>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Custom dialog{" "}
            <span className="text-[var(--color-text-muted)] text-xs font-normal">
              (optional)
            </span>
          </label>
          <textarea
            rows={2}
            placeholder="Kalau nak overwrite dialog dari video referensi..."
            className="input resize-none"
          />
        </div>
      </div>

      <button className="btn-primary w-full mt-6" disabled title="Coming soon">
        <Sparkles className="w-4 h-4" />
        Clone Now
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        ~5 kredit per segment • AI auto-decide 1–4 segments
      </p>
    </div>
  );
}
