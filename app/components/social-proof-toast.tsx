"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

// Rotating "someone in <city> just bought" notification at bottom-right.
// Names are randomly composed (first + last initial) and cities are common
// Malaysian state capitals — original list, not lifted from anywhere.
const NAMES = [
  "Aina", "Faizul", "Hafiz", "Nadia", "Sya", "Rahman", "Aiman", "Liyana",
  "Zikri", "Haziq", "Farah", "Iman", "Danish", "Adam", "Maisarah", "Rizal",
  "Aqil", "Atiqah", "Syafiq", "Sumayyah", "Iskandar", "Nurul", "Farid",
];

const CITIES = [
  "KL", "Shah Alam", "JB", "Penang", "Ipoh", "Kuantan", "Kota Bharu",
  "Kuching", "Kota Kinabalu", "Melaka", "Seremban", "Alor Setar",
];

const ACTIONS = [
  "subscribe Pro Plan",
  "klaim harga RM75",
  "top up kredit",
  "generate 10 video UGC",
  "subscribe sebelum naik harga",
];

type Toast = { name: string; city: string; action: string; minutesAgo: number };

function buildRandom(): Toast {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const lastInitial = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  const minutesAgo = 1 + Math.floor(Math.random() * 18);
  return { name: `${name} ${lastInitial}.`, city, action, minutesAgo };
}

export default function SocialProofToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;

    let mounted = true;

    const showCycle = () => {
      if (!mounted || dismissed) return;
      setToast(buildRandom());
      setVisible(true);
      // Show for 5s, hide for 8s, then loop
      setTimeout(() => mounted && setVisible(false), 5000);
      setTimeout(() => mounted && showCycle(), 13000);
    };

    // Initial delay so it doesn't pop immediately on load
    const initial = setTimeout(showCycle, 6000);
    return () => {
      mounted = false;
      clearTimeout(initial);
    };
  }, [dismissed]);

  if (dismissed || !toast) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-[320px] transition-all duration-500 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-3 p-3 pr-2 rounded-2xl bg-white border border-[var(--color-border)] shadow-2xl shadow-orange-500/15">
        <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-[var(--color-text-primary)] truncate">
            {toast.name} dari {toast.city}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] truncate">
            baru {toast.action}
          </div>
          <div className="text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">
            {toast.minutesAgo} minit yang lepas
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </button>
      </div>
    </div>
  );
}
