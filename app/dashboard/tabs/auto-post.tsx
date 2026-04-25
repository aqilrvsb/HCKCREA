"use client";

import { Send, Calendar, Clock } from "lucide-react";

export default function AutoPostTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
          <Send className="w-5 h-5 text-emerald-600" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Auto Post TikTok</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Schedule video → auto-post ke TikTok Shop
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-bold text-amber-700">
              Coming Soon
            </span>
          </div>
          <p className="text-sm text-amber-700/90 leading-relaxed">
            TikTok auto-posting integration sedang dalam build. Sementara itu,
            anda boleh download video MP4 + caption dan post manual (10 saat).
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Pilih video dari history
          </label>
          <select className="input" disabled>
            <option>— Tiada video lagi —</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            TikTok Shop account
          </label>
          <button
            className="w-full p-4 border border-[var(--color-border)] rounded-2xl flex items-center justify-between text-sm font-medium text-[var(--color-text-muted)] hover:border-emerald-300 transition"
            disabled
          >
            <span>+ Connect TikTok Shop</span>
            <span className="text-xs">Coming soon</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Tarikh</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input type="date" className="input pl-10" disabled />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Masa</label>
            <input type="time" className="input" disabled defaultValue="20:00" />
          </div>
        </div>
      </div>

      <button className="btn-primary w-full mt-6" disabled>
        <Send className="w-4 h-4" />
        Schedule Post
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        1 kredit per scheduled post
      </p>
    </div>
  );
}
