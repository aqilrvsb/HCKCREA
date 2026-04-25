"use client";

import { Wand2, Link as LinkIcon, ArrowRight } from "lucide-react";

export default function AutoContentTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
          <Wand2 className="w-5 h-5 text-violet-600" strokeWidth={2.2} />
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
          <label className="block text-sm font-semibold mb-2">
            Link produk TikTok Shop
          </label>
          <div className="relative">
            <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="url"
              placeholder="https://shop.tiktok.com/view/..."
              className="input pl-11"
            />
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
            Atau upload gambar produk sendiri
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Kuantiti</label>
            <select className="input">
              <option>1 video</option>
              <option>3 video</option>
              <option>5 video</option>
              <option defaultValue="10">10 video</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Duration</label>
            <select className="input">
              <option defaultValue="8">8 saat</option>
              <option>16 saat</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">CTA mode</label>
          <select className="input">
            <option>Beg kuning (TikTok Shop)</option>
            <option>Custom CTA</option>
            <option>Tiada CTA</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Gender</label>
            <select className="input text-sm">
              <option>Auto</option>
              <option>Lelaki</option>
              <option>Perempuan</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Hijab</label>
            <select className="input text-sm">
              <option>Auto</option>
              <option>Hijab</option>
              <option>No-hijab</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Umur</label>
            <select className="input text-sm">
              <option>Auto</option>
              <option>20s</option>
              <option>30s</option>
              <option>40s</option>
            </select>
          </div>
        </div>
      </div>

      <button
        className="btn-primary w-full mt-6"
        disabled
        title="Coming soon"
      >
        Generate 10 Video
        <ArrowRight className="w-4 h-4" />
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        Estimated cost: 40 kredit • ~3 minit
      </p>
    </div>
  );
}
