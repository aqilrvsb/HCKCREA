"use client";

import { useEffect, useState } from "react";
import { Sparkles, Calendar, Receipt, Loader2, Zap, ArrowRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CheckStatusButton from "./check-status-button";
import PricingTiersGrid from "@/components/pricing-tiers-grid";
import LivehostCard from "@/components/livehost-card";
import { PLAN_DEFAULTS, isPlanKey, isLivehost, LIVEHOST, type PlanKey } from "@/lib/plans";

type TngInfo = { number: string; name: string; qr_url: string; configured: boolean };

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

  // Manual Touch 'n Go plan-purchase flow (no FPX). Picking a plan opens this
  // modal: transfer the price to the admin's TnG, upload the screenshot, submit
  // → creates a pending subscription payment the admin approves.
  const [payPlan, setPayPlan] = useState<PlanKey | null>(null);
  const [tng, setTng] = useState<TngInfo | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [qrZoom, setQrZoom] = useState(false);

  useEffect(() => {
    void loadProfile();
    void loadPayments();
    void (async () => {
      try {
        const r = await fetch("/api/credit/tng-info", { cache: "no-store" });
        if (r.ok) setTng(await r.json());
      } catch { /* ignore */ }
    })();
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

  // Picking a plan opens the Touch 'n Go payment modal (no FPX redirect).
  function handleSelect(plan: PlanKey) {
    setPayPlan(plan);
    setProofUrl("");
    setSubmitted(false);
  }

  function closePayModal() {
    setPayPlan(null);
    setProofUrl("");
    setSubmitted(false);
    setQrZoom(false);
  }

  async function uploadProof(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload/image", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok && d?.url) setProofUrl(String(d.url));
      else alert(d?.error || "Upload gagal");
    } catch (e: any) {
      alert(e?.message || "Upload gagal");
    } finally {
      setUploading(false);
    }
  }

  async function submitPlanPurchase() {
    if (!payPlan) return;
    if (!proofUrl) { alert("Upload screenshot transfer dulu."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: payPlan, proof_url: proofUrl }),
      });
      const data = await res.json();
      if (data?.ok) {
        setSubmitted(true);
        setProofUrl("");
        void loadPayments();
      } else {
        alert(data?.error || "Gagal submit langganan");
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setSubmitting(false);
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
                      (() => {
                        // Manual Touch 'n Go payment — no Chip id. Show its
                        // approval status straight from the row.
                        const st =
                          p.status === "paid"
                            ? { t: "✓ Approved", c: "#16a34a", b: "rgba(16,163,74,0.12)" }
                            : p.status === "failed"
                              ? { t: "✗ Rejected", c: "#ef4444", b: "rgba(239,68,68,0.12)" }
                              : { t: "⏳ Pending approval", c: "#f59e0b", b: "rgba(245,158,11,0.12)" };
                        return (
                          <span className="text-[11px] font-bold px-3 py-1 rounded-full" style={{ color: st.c, background: st.b }}>
                            {st.t}
                          </span>
                        );
                      })()
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Touch 'n Go plan-purchase modal (no FPX) ───────────────────── */}
      {payPlan && isPlanKey(payPlan) && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={closePayModal}
        >
          <div
            className="relative w-full max-w-lg my-8 rounded-3xl p-6 md:p-7"
            style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closePayModal}
              aria-label="Tutup"
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="mb-5">
              <div className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
                Langgan plan
              </div>
              <div className="font-display font-extrabold text-2xl tracking-tight">
                {PLAN_DEFAULTS[payPlan].label} Plan
              </div>
              <div className="text-sm text-[var(--color-text-secondary)]">
                RM{PLAN_DEFAULTS[payPlan].price} / {PLAN_DEFAULTS[payPlan].days} hari · + RM{PLAN_DEFAULTS[payPlan].credits} credits
              </div>
            </div>

            {submitted ? (
              <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.35)" }}>
                <div className="font-display font-extrabold text-lg text-emerald-600 mb-1">✓ Permohonan dihantar!</div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Langganan <b>{PLAN_DEFAULTS[payPlan].label}</b> anda sedang <b>menunggu approval admin</b>. Plan akan aktif sebaik admin sahkan screenshot transfer. Terima kasih!
                </p>
                <button onClick={closePayModal} className="mt-3 text-xs font-bold text-amber-600 underline">Tutup</button>
              </div>
            ) : (
              <>
                {/* Step 1 — transfer to Touch 'n Go */}
                <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  <div className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">
                    Langkah 1 — Transfer RM{PLAN_DEFAULTS[payPlan].price} ke Touch &apos;n Go
                  </div>
                  {tng && tng.configured ? (
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-extrabold text-2xl text-[var(--color-text-primary)] tracking-tight break-all">{tng.number || "—"}</div>
                        {tng.name && <div className="text-sm text-[var(--color-text-secondary)] font-semibold">{tng.name}</div>}
                        <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Guna app Touch &apos;n Go / DuitNow QR di sebelah.</div>
                      </div>
                      {tng.qr_url && (
                        <button type="button" onClick={() => setQrZoom(true)} title="Tekan untuk besarkan QR" className="flex-shrink-0 group relative">
                          <img src={tng.qr_url} alt="TnG QR" className="w-28 h-28 object-contain rounded-lg bg-white border border-[var(--color-border)] cursor-zoom-in transition-transform group-hover:scale-105" />
                          <span className="absolute bottom-1 right-1 text-[9px] font-bold text-white bg-black/60 rounded px-1 py-0.5 pointer-events-none">🔍 Besar</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--color-text-muted)]">Admin belum set akaun Touch &apos;n Go. Sila hubungi admin.</div>
                  )}
                </div>

                {/* Amount callout */}
                <div className="rounded-2xl p-4 mb-4 flex items-center justify-between" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,87,34,0.08))", border: "1px solid rgba(245,158,11,0.4)" }}>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-[var(--color-text-muted)]">Jumlah untuk transfer</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">{PLAN_DEFAULTS[payPlan].label} · {PLAN_DEFAULTS[payPlan].days} hari</div>
                  </div>
                  <div className="font-display font-extrabold text-3xl text-amber-500">RM{PLAN_DEFAULTS[payPlan].price}</div>
                </div>

                {/* Step 2 — screenshot upload */}
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">
                    Langkah 2 — Upload screenshot transfer
                  </div>
                  <label className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border-2 border-dashed cursor-pointer transition-colors"
                    style={{ borderColor: proofUrl ? "#16a34a" : "var(--color-border)", background: proofUrl ? "rgba(16,185,129,0.06)" : "var(--color-bg-card)" }}>
                    {uploading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                    ) : proofUrl ? (
                      <span className="text-sm font-bold text-emerald-600">✓ Screenshot dimuat naik — tekan tukar untuk ganti</span>
                    ) : (
                      <span className="text-sm font-semibold text-[var(--color-text-secondary)]">📷 Pilih screenshot resit transfer</span>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadProof(f); }} />
                  </label>
                  {proofUrl && <img src={proofUrl} alt="proof" className="mt-2 max-h-40 rounded-lg border border-[var(--color-border)]" />}
                </div>

                <button
                  onClick={submitPlanPurchase}
                  disabled={submitting || !proofUrl || !(tng && tng.configured)}
                  className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-xl shadow-amber-500/30 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:scale-100"
                  style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)" }}
                >
                  <span className="flex items-center justify-center gap-2">
                    {submitting ? (<><Loader2 className="w-5 h-5 animate-spin" /> Menghantar…</>) : (<><Zap className="w-5 h-5" /> Submit langganan RM{PLAN_DEFAULTS[payPlan].price} <ArrowRight className="w-4 h-4" /></>)}
                  </span>
                </button>
                <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">
                  Plan aktif selepas admin approve screenshot anda (biasanya cepat).
                </p>
              </>
            )}
          </div>

          {/* Enlarged QR */}
          {qrZoom && tng?.qr_url && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
              onClick={(e) => { e.stopPropagation(); setQrZoom(false); }}
            >
              <div className="relative bg-white rounded-2xl p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => setQrZoom(false)} aria-label="Tutup" className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-black text-white text-lg font-bold flex items-center justify-center shadow-lg">×</button>
                <img src={tng.qr_url} alt="TnG QR besar" className="w-[min(80vw,380px)] h-[min(80vw,380px)] object-contain" />
                <div className="text-center text-xs font-semibold text-gray-700 mt-2">Scan guna app Touch &apos;n Go / DuitNow</div>
              </div>
            </div>
          )}
        </div>
      )}
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
