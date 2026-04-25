"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

// 5-hour rolling countdown that resets when it hits 0 — keeps urgency fresh
// for repeat visits without needing a server-side promo end date.
export default function Countdown({ hoursTotal = 5 }: { hoursTotal?: number }) {
  const [remaining, setRemaining] = useState(hoursTotal * 60 * 60);

  useEffect(() => {
    // Anchor to localStorage so the countdown is consistent within a browser
    // session — when it hits 0, restart for the next visit.
    const KEY = "peninglab_promo_end";
    let endAt: number;
    const stored = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    const now = Date.now();
    if (stored && Number(stored) > now) {
      endAt = Number(stored);
    } else {
      endAt = now + hoursTotal * 60 * 60 * 1000;
      try { localStorage.setItem(KEY, String(endAt)); } catch {}
    }

    const tick = () => {
      const diff = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
      setRemaining(diff);
      if (diff <= 0) {
        // Restart the timer
        endAt = Date.now() + hoursTotal * 60 * 60 * 1000;
        try { localStorage.setItem(KEY, String(endAt)); } catch {}
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hoursTotal]);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  const Cell = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center">
      <div
        className="flex items-center justify-center min-w-[64px] md:min-w-[72px] h-16 md:h-20 rounded-2xl font-display font-extrabold text-3xl md:text-4xl tracking-tight tabular-nums text-white"
        style={{
          background: "linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)",
          boxShadow: "0 8px 24px rgba(10,10,10,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {String(value).padStart(2, "0")}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-muted)] font-bold mt-2">
        {label}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto mb-8">
      <div className="flex items-center justify-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-orange animate-pulse" />
        <span className="text-sm font-bold uppercase tracking-widest text-orange">
          Promo berakhir dalam
        </span>
      </div>
      <div className="flex items-center justify-center gap-3 md:gap-5">
        <Cell value={h} label="Jam" />
        <span className="font-display font-extrabold text-3xl md:text-4xl text-[var(--color-text-muted)]">
          :
        </span>
        <Cell value={m} label="Min" />
        <span className="font-display font-extrabold text-3xl md:text-4xl text-[var(--color-text-muted)]">
          :
        </span>
        <Cell value={s} label="Saat" />
      </div>
    </div>
  );
}
