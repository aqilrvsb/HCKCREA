"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

// Sticky bottom CTA bar — appears after user scrolls past the hero, hidden
// when they reach the checkout section (no need to nag once they're there).
// Critical for paid ad traffic — drops bounce rate by giving a constant
// 'buy' anchor.
export default function StickyCTABar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      const checkout = document.getElementById("checkout");
      const checkoutTop = checkout?.getBoundingClientRect().top ?? 9999;
      // Show after user scrolls past first 600px AND checkout isn't yet on screen
      setVisible(scrollY > 600 && checkoutTop > window.innerHeight);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto max-w-3xl px-4 pb-3">
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border border-orange-200 shadow-2xl shadow-orange-500/25">
          <div className="hidden sm:block flex-1">
            <div className="text-xs font-mono uppercase tracking-wider text-orange font-bold">
              Promo period
            </div>
            <div className="font-bold text-sm">
              <span className="text-[var(--color-text-muted)] line-through decoration-red-500 decoration-2 mr-1.5">
                RM300
              </span>
              RM75 / bulan
            </div>
          </div>
          <div className="sm:hidden flex-1 text-xs">
            <span className="line-through text-[var(--color-text-muted)] decoration-red-500">
              RM300
            </span>
            <span className="font-bold ml-1.5 text-base">RM75</span>
          </div>
          <a
            href="#checkout"
            className="btn-primary !py-3 !px-5 text-sm whitespace-nowrap"
          >
            Bayar Sekarang
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
        <div className="hidden sm:flex items-center justify-center gap-2 mt-1.5 text-[10px] text-[var(--color-text-muted)]">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          <span>FPX online banking · 30-day money back · Cancel bila-bila</span>
        </div>
      </div>
    </div>
  );
}
