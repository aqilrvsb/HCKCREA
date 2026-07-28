"use client";

import { useEffect, useState } from "react";
import { Sparkles, Calendar, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CheckStatusButton from "./check-status-button";
import PricingTiersGrid from "@/components/pricing-tiers-grid";
import LivehostCard from "@/components/livehost-card";
import { PLAN_DEFAULTS, isPlanKey, isLivehost, LIVEHOST, type PlanKey } from "@/lib/plans";

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

export default function BillingSection({ initialPlan }: { initialPlan?: string } = {}) {
  // Seed the plan so the correct layout (e.g. Livehost) renders on first paint
  // instead of flashing the generation "Choose your plan" view until the fetch.
  const [currentPlan, setCurrentPlan] = useState<string>(initialPlan || "free");
  const [renewalRaw, setRenewalRaw] = useState<string | null>(null);
  const [renewalDate, setRenewalDate] = useState<string>("—");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState<PlanKey | null>(null);

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

  async function handleSelect(plan: PlanKey) {
    setLoading(plan);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert(data?.error || "Failed to start subscription");
        setLoading(null);
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
      setLoading(null);
    }
  }

  const planActive =
    isPlanKey(currentPlan) &&
    !!renewalRaw &&
    new Date(renewalRaw) > new Date();
  const planLabel = isPlanKey(currentPlan)
    ? PLAN_DEFAULTS[currentPlan].label
    : "Free";

  return (
    <div className="space-y-8">
      {/* Status hero — current plan summary OR no-plan CTA */}
      {planActive ? (
        <ActivePlanHero name={planLabel} renewalDate={renewalDate} />
      ) : (
        <NoPlanHero
          expired={!!renewalRaw && new Date(renewalRaw) < new Date()}
          renewalDate={renewalDate}
        />
      )}

      {/* Livehost users see ONLY the Livehost package; everyone else sees
          the 4-tier grid plus the Livehost card as a separate option. */}
      {isLivehost(currentPlan) ? (
        <div>
          <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5">
            Your package
          </h3>
          <LivehostCard
            mode="dashboard"
            currentPlan={currentPlan}
            currentExpiry={renewalRaw}
            loading={loading === LIVEHOST}
            onSelect={() => handleSelect(LIVEHOST)}
          />
        </div>
      ) : (
        <>
          <div>
            <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5">
              Choose your plan
            </h3>
            <PricingTiersGrid
              mode="dashboard"
              currentPlan={currentPlan}
              currentExpiry={renewalRaw}
              loading={loading}
              onSelect={handleSelect}
            />
          </div>

          {/* Livehost card hidden from Billing per user direction 2026-07-28
              (separate package, sold elsewhere). Re-enable by uncommenting.
          <div>
            <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5">
              Or go Livehost
            </h3>
            <LivehostCard
              mode="dashboard"
              currentPlan={currentPlan}
              currentExpiry={renewalRaw}
              loading={loading === LIVEHOST}
              onSelect={() => handleSelect(LIVEHOST)}
            />
          </div>
          */}
        </>
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
                      ? `${
                          isPlanKey(p.plan ?? "")
                            ? PLAN_DEFAULTS[p.plan as PlanKey].label
                            : (p.plan || "Plan").toUpperCase()
                        } Plan`
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
          <p className="text-white/80 text-lg">
            Active subscription · Renews {renewalDate}
          </p>
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
        </div>
      </div>
    </div>
  );
}

function NoPlanHero({
  expired,
  renewalDate,
}: {
  expired: boolean;
  renewalDate: string;
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
          {expired ? "Subscription expired" : "Pick a plan to start"}
        </h2>
        <p className="text-white/70 text-base max-w-xl">
          {expired
            ? `Subscription habis tempoh pada ${renewalDate}. Subscribe semula bawah untuk continue generating.`
            : "Akses penuh — Image AI, Video AI, Auto Content, Clone, Story Telling. Pilih plan ikut bajet bawah."}
        </p>
      </div>
    </div>
  );
}
