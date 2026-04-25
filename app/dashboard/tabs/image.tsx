"use client";

import { ImageIcon, Sparkles, Upload } from "lucide-react";

export default function ImageTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-blue-600" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Generate Image</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Avatar UGC realistik untuk produk anda
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Prompt</label>
          <textarea
            rows={4}
            placeholder="Contoh: A confident young Malay woman wearing a hijab, holding a skincare bottle, soft natural lighting, studio backdrop..."
            className="input resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Reference produk{" "}
            <span className="text-[var(--color-text-muted)] text-xs font-normal">
              (optional)
            </span>
          </label>
          <button className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-blue-300 hover:bg-blue-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Upload className="w-6 h-6" />
            Click to upload product image
            <span className="text-xs">PNG / JPG / max 8MB</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Aspect</label>
            <select className="input text-sm">
              <option>9:16 (TikTok)</option>
              <option>1:1 (Square)</option>
              <option>16:9 (Wide)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Quality</label>
            <select className="input text-sm">
              <option>HD</option>
              <option>Standard</option>
            </select>
          </div>
        </div>
      </div>

      <button
        className="btn-primary w-full mt-6"
        disabled
        title="Coming soon"
      >
        <Sparkles className="w-4 h-4" />
        Generate Image
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        2 kredit per image
      </p>
    </div>
  );
}
