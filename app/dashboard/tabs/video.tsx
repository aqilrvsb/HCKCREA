"use client";

import { Video, Sparkles, Upload } from "lucide-react";

export default function VideoTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-pink-50 border border-pink-100 flex items-center justify-center">
          <Video className="w-5 h-5 text-pink-600" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Generate Video</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Veo 3.1 — 8 saat atau 16 saat
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Prompt</label>
          <textarea
            rows={4}
            placeholder="Contoh: A young Malay woman holds skincare bottle, smiles directly to camera, says 'Eh korang, serius kena cuba ni'..."
            className="input resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Reference image
          </label>
          <button className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-pink-300 hover:bg-pink-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Upload className="w-6 h-6" />
            Upload character / product image
            <span className="text-xs">Optional — text-to-video also supported</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Duration</label>
            <select className="input text-sm">
              <option>8 saat</option>
              <option>16 saat</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Mode</label>
            <select className="input text-sm">
              <option>Reference-to-video (r2v)</option>
              <option>Image-to-video (i2v)</option>
              <option>Text-to-video (t2v)</option>
            </select>
          </div>
        </div>
      </div>

      <button className="btn-primary w-full mt-6" disabled title="Coming soon">
        <Sparkles className="w-4 h-4" />
        Generate Video
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        4 kredit per 8s video • 8 kredit per 16s
      </p>
    </div>
  );
}
