"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Calendar,
  ShieldCheck,
  Loader2,
  Receipt,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CheckStatusButton from "./check-status-button";

type Payment = {
  id: string;
  type: string;
  plan?: string;
  credits?: number;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded";
  chip_purchase_id?: string;
  chip_checkout_url?: string;
  created_at: string;
};

// Single-plan SaaS — Pro Plan only. Pricing + features mirror the landing
// page hero so the dashboard subscribe flow stays consistent. RM75 promo
// price vs RM300 markup, monthly recurring.
const PRO_PLAN = {
  key: "pro",
  name: "Pro Plan",
  price: 75,
  markup: 300,
  period: "/bulan",
  features: [
    "Image AI — 20 sen",
    "Video AI — 40 sen",
    "Unlimited Generate",
    "Access Prompt Library",
    "Access Image Studio",
    "Access Video Studio",
    "Access Auto Content",
    "Access Clone Video",
    "Access Story Telling",
    "Access Group VIP",
  ],
};

export default function BillingSection() {
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [renewalDate, setRenewalDate] = useState<string>("—");
  const [renewalRaw, setRenewalRaw] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingSub, setLoadingSub] = useState(false);

  useEffect(() => {
    void loadProfile();
    void loadPayments();
  }, []);

  async function loadProfile() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("profiles")
      .select("plan, plan_expires_at")
      .eq("id", user.id)
      .single();
    if (data) {
      setCurrentPlan(data.plan || "free");
      if (data.plan_expires_at) {
        setRenewalRaw(data.plan_expires_at);
        setRenewalDate(
          new Date(data.plan_expires_at).toLocaleDateString("ms-MY", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        );
      } else {
        setRenewalRaw(null);
        setRenewalDate("—");
      }
    }
  }

  async function loadPayments() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("payments")
      .select(
        "id,type,plan,credits,amount,status,chip_purchase_id,chip_checkout_url,created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setPayments((data as Payment[]) || []);
  }

  async function startSubscribe() {
    setLoadingSub(true);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: PRO_PLAN.key }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert(data?.error || "Failed to start subscription");
        setLoadingSub(false);
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
      setLoadingSub(false);
    }
  }

  const isPro = currentPlan === "pro";
  const expired = renewalRaw ? new Date(renewalRaw) < new Date() : false;
  const isActive = isPro && !expired;

  return (
    <div className="space-y-6">
      {/* Hero — current plan summary */}
      {isActive ? (
        <ActivePlanHero name={PRO_PLAN.name} renewalDate={renewalDate} />
      ) : (
        <NoPlanHero
          expired={expired}
          renewalDate={renewalDate}
          onSubscribe={startSubscribe}
          loading={loadingSub}
        />
      )}

      {/* Pro Plan card — shown unless user is already on Pro & active */}
      {!isActive && (
        <ProPlanCard onSubscribe={startSubscribe} loading={loadingSub} />
      )}

      {/* Payment history */}
      <div>
        <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5 flex items-center gap-2">
          <Receipt className="w-5 h-5 text-[var(--color-text-muted)]" />
          Payment history
        </h3>
        <div className="card p-0 overflow-hidden">
          <div
            className="hidden md:flex px-6 py-4 border-b border-[var(--color-border)] items-center text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]"
            style={{ background: "rgba(255,87,34,0.04)" }}
          >
            <span className="w-32">Date</span>
            <span className="flex-1">Description</span>
            <span className="w-24">Amount</span>
            <span className="w-44 text-right">Status</span>
          </div>
          {payments.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[var(--color-text-secondary)] font-medium">
                Tiada payment history lagi.
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Subscribe pertama kali, transaction akan muncul di sini.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3"
                >
                  <span className="w-32 text-sm text-[var(--color-text-secondary)] font-mono">
                    {new Date(p.created_at).toLocaleDateString("ms-MY", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </span>
                  <span className="flex-1 text-sm font-semibold">
                    {p.type === "subscription"
                      ? `Pro Plan ${p.plan ? `· ${p.plan.toUpperCase()}` : ""}`
                      : `Top up ${p.credits ?? 0} credits`}
                  </span>
                  <span className="w-24 text-sm font-bold">
                    RM{Number(p.amount).toFixed(2)}
                  </span>
                  <div className="md:w-44 md:flex md:justify-end">
                    {p.chip_purchase_id ? (
                      <CheckStatusButton
                        chipPurchaseId={p.chip_purchase_id}
                        initialStatus={p.status}
                        onUpdate={() => {
                          void loadPayments();
                          void loadProfile();
                        }}
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
    </div>
  );
}

// ── Hero variants ─────────────────────────────────────────────────────────
function ActivePlanHero({
  name,
  renewalDate,
}: {
  name: string;
  renewalDate: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background:
          "linear-gradient(135deg, #1a0a05 0%, #2d1208 50%, #4d1f0a 100%)",
      }}
    >
      <div
        className="absolute"
        style={{
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255, 87, 34, 0.4), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative grid md:grid-cols-2 gap-8 items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/15 border border-white/20 backdrop-blur-md text-xs font-bold uppercase tracking-wider text-white">
            <Sparkles className="w-3 h-3" />
            Current Plan
          </div>
          <h2 className="font-display font-extrabold text-5xl md:text-6xl tracking-tight text-white mb-3">
            {name}
          </h2>
          <p className="text-white/80 text-lg mb-6">
            Active subscription · Renews {renewalDate}
          </p>
          <button className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white font-semibold text-sm hover:bg-white/15 transition backdrop-blur-md">
            Cancel subscription
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
            <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
              Renewal
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-white/80" />
              <span className="text-white font-semibold text-sm">
                {renewalDate}
              </span>
            </div>
          </div>
          <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
            <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
              Status
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white font-semibold text-sm">Active</span>
            </div>
          </div>
          <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md col-span-2">
            <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
              Rates
            </div>
            <div className="flex items-baseline gap-3 text-white">
              <span className="font-display font-extrabold text-2xl">RM 0.20</span>
              <span className="text-sm text-white/70">image</span>
              <span className="text-white/40">·</span>
              <span className="font-display font-extrabold text-2xl">RM 0.40</span>
              <span className="text-sm text-white/70">video 8s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoPlanHero({
  expired,
  renewalDate,
  onSubscribe,
  loading,
}: {
  expired: boolean;
  renewalDate: string;
  onSubscribe: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background:
          "linear-gradient(135deg, #1a1a1a 0%, #1d1310 50%, #2d1810 100%)",
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
            "radial-gradient(circle, rgba(255, 87, 34, 0.18), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/8 border border-white/15 text-xs font-bold uppercase tracking-wider text-white/80">
          {expired ? "Expired" : "No active plan"}
        </div>
        <h2 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight text-white mb-3">
          {expired ? "Subscription expired" : "Subscribe Pro Plan"}
        </h2>
        <p className="text-white/70 text-base mb-6 max-w-xl">
          {expired
            ? `Subscription habis tempoh pada ${renewalDate}. Renew untuk continue generating tanpa limit.`
            : "Akses penuh — Image AI, Video AI, Auto Content, Clone Video. Unlimited generate. Tukar bila-bila, pro-rated billing."}
        </p>
        <button
          onClick={onSubscribe}
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-extrabold text-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          style={{
            background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
            color: "#000",
            boxShadow: "0 8px 24px rgba(250,204,21,0.35)",
          }}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Redirecting…
            </>
          ) : (
            <>
              {expired ? "Renew now" : "Subscribe RM75/bulan"}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Single Pro Plan card ──────────────────────────────────────────────────
function ProPlanCard({
  onSubscribe,
  loading,
}: {
  onSubscribe: () => void;
  loading: boolean;
}) {
  return (
    <div className="max-w-2xl mx-auto relative pt-6">
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 z-10 px-5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest text-black shadow-lg whitespace-nowrap"
        style={{
          background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
          boxShadow: "0 8px 24px rgba(250,204,21,0.35)",
        }}
      >
        ⚡ Limited offer · Save 75%
      </div>
      <div
        className="card relative overflow-visible"
        style={{
          borderColor: "rgba(255,87,34,0.4)",
          borderWidth: 2,
          padding: "2.5rem 2rem 2rem",
        }}
      >
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest mb-4"
            style={{
              background: "rgba(255,87,34,0.1)",
              border: "1px solid rgba(255,87,34,0.3)",
              color: "var(--color-orange)",
            }}
          >
            <Sparkles className="w-3 h-3" />
            Pro Plan
          </div>

          <div className="flex items-center justify-center gap-3 mb-1">
            <span className="text-2xl font-display font-bold text-[var(--color-text-muted)] line-through decoration-red-500 decoration-[3px]">
              RM300
            </span>
            <span
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md"
              style={{
                background: "rgba(244,67,54,0.15)",
                color: "#ef4444",
                border: "1px solid rgba(244,67,54,0.3)",
              }}
            >
              Save RM225
            </span>
          </div>
          <div className="flex items-baseline justify-center gap-1">
            <span
              className="font-display font-extrabold text-7xl md:text-8xl tracking-tight leading-none"
              style={{
                background:
                  "linear-gradient(135deg, #facc15 0%, #eab308 60%, #ca8a04 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              RM75
            </span>
            <span className="text-[var(--color-text-muted)] text-base">/bulan</span>
          </div>
          <div
            className="mt-3 text-sm font-semibold"
            style={{ color: "var(--color-orange)" }}
          >
            Promo period — harga naik balik selepas habis.
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 mb-7">
          {PRO_PLAN.features.map((f, j) => (
            <div key={j} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--color-text-secondary)]">{f}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onSubscribe}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-extrabold text-base text-black transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
            boxShadow: "0 8px 24px rgba(250,204,21,0.35)",
          }}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Redirecting to Chip…
            </>
          ) : (
            <>
              Klaim harga RM75 sekarang
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] text-[var(--color-text-muted)]">
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>30-day money back</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Cancel bila-bila</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>FPX / Card / QR</span>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--color-text-muted)]">
          Bayar via FPX, Credit/Debit Card (Visa, Mastercard), DuitNow QR, atau
          e-Wallet — pilih method di Chip checkout.
        </p>
      </div>
    </div>
  );
}
