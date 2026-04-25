"use client";

import { useState } from "react";
import { Wallet, Zap, ArrowRight, Receipt, Sparkles } from "lucide-react";

const PACKAGES = [
  { credits: 10, price: 10, label: "Starter pack" },
  { credits: 20, price: 20, label: "Try it out" },
  { credits: 30, price: 30, label: "Common" },
  { credits: 50, price: 50, label: "Best value", popular: true },
  { credits: 100, price: 100, label: "Power user" },
];

export default function CreditSection({ credits }: { credits: number }) {
  const [selected, setSelected] = useState(50);

  const pick = PACKAGES.find((p) => p.credits === selected) || PACKAGES[0];

  return (
    <div className="space-y-6">
      {/* Hero balance — bold display */}
      <div
        className="relative overflow-hidden rounded-3xl p-8 md:p-10"
        style={{
          background:
            "linear-gradient(135deg, #fef3c7 0%, #fde68a 30%, #fce7f3 100%)",
          border: "1px solid #fbbf24",
        }}
      >
        <div
          className="absolute"
          style={{
            top: -120,
            right: -120,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(245, 158, 11, 0.35), transparent 70%)",
            filter: "blur(50px)",
          }}
        />

        <div className="relative grid md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/80 border border-amber-300 backdrop-blur-md text-xs font-bold uppercase tracking-wider text-amber-800">
              <Wallet className="w-3 h-3" />
              Credit Balance
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-display font-extrabold text-7xl md:text-8xl tracking-tight text-amber-900 leading-none">
                {credits.toFixed(2)}
              </span>
              <span className="text-amber-700 font-semibold text-xl">
                credits
              </span>
            </div>
            <p className="text-amber-800/80 text-base">
              Top up bila-bila. Kredit tak hangus.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-5 bg-white/70 border border-amber-200 backdrop-blur-md">
              <div className="text-xs uppercase tracking-wider text-amber-700 font-bold mb-1.5">
                Image generate
              </div>
              <div className="font-display font-extrabold text-2xl text-amber-900">
                ~{Math.floor(credits / 0.2)}
              </div>
              <div className="text-xs text-amber-700/70">images possible</div>
            </div>
            <div className="rounded-2xl p-5 bg-white/70 border border-amber-200 backdrop-blur-md">
              <div className="text-xs uppercase tracking-wider text-amber-700 font-bold mb-1.5">
                Video 8s
              </div>
              <div className="font-display font-extrabold text-2xl text-amber-900">
                ~{Math.floor(credits / 0.4)}
              </div>
              <div className="text-xs text-amber-700/70">videos possible</div>
            </div>
            <div className="rounded-2xl p-5 bg-white/70 border border-amber-200 backdrop-blur-md col-span-2">
              <div className="text-xs uppercase tracking-wider text-amber-700 font-bold mb-1.5">
                Auto Content (10 video pack)
              </div>
              <div className="font-display font-extrabold text-2xl text-amber-900">
                ~{Math.floor(credits / 4.1)} batch
              </div>
              <div className="text-xs text-amber-700/70">
                10 video × 8s + 1 master plan
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Package selector */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display font-extrabold text-2xl tracking-tight">
              Select credit package
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              RM1 = 1 kredit. No hidden fees.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Instant top-up
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {PACKAGES.map((p) => {
            const isSelected = selected === p.credits;
            return (
              <button
                key={p.credits}
                onClick={() => setSelected(p.credits)}
                className={`relative rounded-2xl p-5 border-2 text-left transition-all ${
                  isSelected
                    ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-50 shadow-lg shadow-amber-500/20 scale-[1.03]"
                    : "border-[var(--color-border)] bg-white hover:border-amber-200"
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-2 right-3 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-md">
                    Best
                  </div>
                )}
                <div className="font-display font-extrabold text-3xl tracking-tight mb-1">
                  {p.credits}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-2">
                  credits
                </div>
                <div className="font-bold text-base">RM{p.price}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  {p.label}
                </div>
              </button>
            );
          })}
        </div>

        <button
          className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-xl shadow-amber-500/30 hover:scale-[1.01] transition-transform"
          style={{
            background:
              "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
          }}
        >
          <span className="flex items-center justify-center gap-2">
            <Zap className="w-5 h-5" />
            Pay RM{pick.price} for {pick.credits} Credits
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">
          Secured payment via Billplz · Stripe · TouchnGo eWallet
        </p>
      </div>

      {/* Top up history */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="font-display font-bold text-lg">Top up history</h3>
        </div>
        <div className="px-6 py-12 text-center">
          <p className="text-[var(--color-text-secondary)] font-medium">
            Tiada top up history lagi.
          </p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Top up pertama kali, transaction akan muncul di sini.
          </p>
        </div>
      </div>
    </div>
  );
}
