"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  Zap,
  ArrowRight,
  Receipt,
  Sparkles,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CheckStatusButton from "./check-status-button";

const PACKAGES = [
  { credits: 10, price: 10, label: "Starter pack" },
  { credits: 20, price: 20, label: "Try it out" },
  { credits: 30, price: 30, label: "Common" },
  { credits: 50, price: 50, label: "Best value", popular: true },
  { credits: 100, price: 100, label: "Power user" },
];

type Topup = {
  id: string;
  credits?: number;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded";
  chip_purchase_id?: string;
  created_at: string;
};

export default function CreditSection({ credits }: { credits: number }) {
  const [selected, setSelected] = useState(50);
  const [paying, setPaying] = useState(false);
  const [topups, setTopups] = useState<Topup[]>([]);

  const pick = PACKAGES.find((p) => p.credits === selected) || PACKAGES[0];

  useEffect(() => {
    void loadTopups();
  }, []);

  async function loadTopups() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("payments")
      .select("id,credits,amount,status,chip_purchase_id,created_at")
      .eq("user_id", user.id)
      .eq("type", "credit_topup")
      .order("created_at", { ascending: false })
      .limit(20);
    setTopups((data as Topup[]) || []);
  }

  async function startTopup() {
    setPaying(true);
    try {
      const res = await fetch("/api/credit/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: pick.credits }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert(data?.error || "Failed to start top-up");
        setPaying(false);
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
      setPaying(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero balance — dark amber theme */}
      <div
        className="relative overflow-hidden rounded-3xl p-8 md:p-10"
        style={{
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(255,87,34,0.06) 100%)",
          border: "1px solid rgba(245,158,11,0.3)",
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
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full text-xs font-bold uppercase tracking-wider"
              style={{
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#fbbf24",
              }}
            >
              <Wallet className="w-3 h-3" />
              Credit Balance
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span
                className="font-display font-extrabold text-7xl md:text-8xl tracking-tight leading-none"
                style={{ color: "#fbbf24" }}
              >
                {credits.toFixed(2)}
              </span>
              <span className="font-semibold text-xl text-[var(--color-text-secondary)]">
                credits
              </span>
            </div>
            <p className="text-base text-[var(--color-text-secondary)]">
              Top up bila-bila. Kredit tak hangus.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded-2xl p-5 border"
              style={{
                background: "rgba(245,158,11,0.05)",
                borderColor: "rgba(245,158,11,0.25)",
              }}
            >
              <div
                className="text-xs uppercase tracking-wider font-bold mb-1.5"
                style={{ color: "#fbbf24" }}
              >
                Image generate
              </div>
              <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)]">
                ~{Math.floor(credits / 0.2)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">images possible</div>
            </div>
            <div
              className="rounded-2xl p-5 border"
              style={{
                background: "rgba(245,158,11,0.05)",
                borderColor: "rgba(245,158,11,0.25)",
              }}
            >
              <div
                className="text-xs uppercase tracking-wider font-bold mb-1.5"
                style={{ color: "#fbbf24" }}
              >
                Video 8s
              </div>
              <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)]">
                ~{Math.floor(credits / 0.4)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">videos possible</div>
            </div>
            <div
              className="rounded-2xl p-5 border col-span-2"
              style={{
                background: "rgba(245,158,11,0.05)",
                borderColor: "rgba(245,158,11,0.25)",
              }}
            >
              <div
                className="text-xs uppercase tracking-wider font-bold mb-1.5"
                style={{ color: "#fbbf24" }}
              >
                Auto Content (10 video pack)
              </div>
              <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)]">
                ~{Math.floor(credits / 4.1)} batch
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
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
            Instant top-up via Chip
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {PACKAGES.map((p) => {
            const isSelected = selected === p.credits;
            return (
              <button
                key={p.credits}
                onClick={() => setSelected(p.credits)}
                className="relative rounded-2xl p-5 border-2 text-left transition-all"
                style={
                  isSelected
                    ? {
                        borderColor: "#fbbf24",
                        background:
                          "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(255,87,34,0.06) 100%)",
                        boxShadow: "0 8px 24px rgba(245,158,11,0.2)",
                        transform: "scale(1.03)",
                      }
                    : {
                        borderColor: "var(--color-border)",
                        background: "var(--color-bg-card)",
                      }
                }
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
          onClick={startTopup}
          disabled={paying}
          className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-xl shadow-amber-500/30 hover:scale-[1.01] transition-transform disabled:opacity-70 disabled:scale-100"
          style={{
            background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
          }}
        >
          <span className="flex items-center justify-center gap-2">
            {paying ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Redirecting to Chip…
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Pay RM{pick.price} for {pick.credits} Credits
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </span>
        </button>
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">
          Secured payment via Chip · FPX, e-wallet, card supported
        </p>
      </div>

      {/* Top up history */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h3 className="font-display font-bold text-lg">Top up history</h3>
        </div>
        {topups.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[var(--color-text-secondary)] font-medium">
              Tiada top up history lagi.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Top up pertama kali, transaction akan muncul di sini.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {topups.map((t) => (
              <li
                key={t.id}
                className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3"
              >
                <span className="w-32 text-sm text-[var(--color-text-secondary)] font-mono">
                  {new Date(t.created_at).toLocaleDateString("ms-MY", {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })}
                </span>
                <span className="flex-1 text-sm font-semibold">
                  +{t.credits} credits
                </span>
                <span className="w-24 text-sm font-bold">
                  RM{Number(t.amount).toFixed(2)}
                </span>
                <div className="md:w-44 md:flex md:justify-end">
                  {t.chip_purchase_id ? (
                    <CheckStatusButton
                      chipPurchaseId={t.chip_purchase_id}
                      initialStatus={t.status}
                      onUpdate={() => void loadTopups()}
                    />
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)] italic">
                      no purchase id
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
