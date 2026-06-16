"use client";

import { ArrowRight, Loader2, Radio, CheckCircle2 } from "lucide-react";
import { PLAN_DEFAULTS, LIVEHOST } from "@/lib/plans";

// Livehost is a SEPARATE package (RM500/mo) rendered as its own card —
// NOT inside the 4-tier grid. Used on the landing page (marketing mode)
// and the dashboard Billing section (dashboard mode).
//
// Marketing mode: clicking Subscribe writes the plan to sessionStorage +
// dispatches the same event PricingTiersGrid uses, so CheckoutForm picks
// up "livehost" and scrolls into view.
// Dashboard mode: the parent's onSelect handles the /api/billing/subscribe
// call (same as the 4 tiers).

const SELECTED_PLAN_STORAGE_KEY = "peninglab:selected-plan";
const PLAN_CHANGE_EVENT = "peninglab:plan-changed";

function selectLivehostAndScrollToCheckout() {
  try {
    sessionStorage.setItem(SELECTED_PLAN_STORAGE_KEY, LIVEHOST);
    window.dispatchEvent(new Event(PLAN_CHANGE_EVENT));
  } catch {
    // sessionStorage blocked — checkout form keeps its default.
  }
  const target = document.getElementById("checkout");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Placeholder feature lines — the Livehost product/dashboard is designed
// later. Keep generic so the card reads as a premium, separate offering.
const FEATURES = [
  "Dedicated Livehost dashboard",
  "Live hosting tools (coming soon)",
  "Priority WhatsApp support",
  "Separate from the generation plans",
];

type Mode = "dashboard" | "marketing";

export default function LivehostCard({
  mode,
  currentPlan,
  currentExpiry,
  loading,
  onSelect,
}: {
  mode: Mode;
  currentPlan?: string | null;
  currentExpiry?: string | null;
  /** True while the parent is starting the subscribe call. */
  loading?: boolean;
  /** Dashboard mode — parent handles the API call. */
  onSelect?: () => void;
}) {
  const cfg = PLAN_DEFAULTS[LIVEHOST];
  const now = Date.now();
  const expiryMs = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const isLivehostPlan = currentPlan === LIVEHOST;
  const isActive = expiryMs > now;                 // still within the paid cycle
  // Renew only AFTER expiry — renewing early resets the 30-day cycle and
  // forfeits the remaining days, so we block it while still active.
  const renewDisabled = isActive;
  const expiryStr = expiryMs
    ? new Date(expiryMs).toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-7 md:p-8"
      style={{
        background:
          "linear-gradient(135deg, #0b1220 0%, #11203a 55%, #0a1830 100%)",
        border: "2px solid rgba(96, 165, 250, 0.45)",
        boxShadow: "0 12px 32px rgba(37, 99, 235, 0.18)",
      }}
    >
      <div
        className="absolute"
        style={{
          top: -90,
          right: -90,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.35), transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative grid md:grid-cols-2 gap-6 items-center">
        {/* Left — identity + price */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-4 rounded-full text-[10px] font-bold uppercase tracking-widest text-white"
            style={{ background: "rgba(96,165,250,0.18)", border: "1px solid rgba(96,165,250,0.4)" }}
          >
            <Radio className="w-3 h-3" />
            New · Livehost
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display font-extrabold text-5xl tracking-tight text-white">
              RM{cfg.price}
            </span>
            <span className="text-sm text-white/60">/{cfg.days} hari</span>
          </div>
          <p className="mt-2 text-white/70 text-sm max-w-sm">
            Pakej khas untuk live hosting — dashboard berasingan, bukan sebahagian
            plan generation. Sesuai untuk host yang nak tools tersendiri.
          </p>
        </div>

        {/* Right — features + CTA */}
        <div className="space-y-3">
          <div className="space-y-2">
            {[`RM${cfg.credits} kredit usage disertakan (GPU + suara)`, ...FEATURES].map((f) => (
              <div key={f} className="flex items-start gap-2 text-[13px] text-white/85">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
                <span>{f}</span>
              </div>
            ))}
          </div>

          {isLivehostPlan ? (
            <div className="flex flex-col gap-2">
              <div
                className="text-center py-2 rounded-xl text-xs font-bold uppercase tracking-wider"
                style={isActive
                  ? { background: "rgba(96,165,250,0.15)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.3)" }
                  : { background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                {isActive ? "Current Package" : "Tamat — renew untuk sambung"}
              </div>
              {mode === "dashboard" && onSelect && (
                <>
                  <button
                    onClick={onSelect}
                    disabled={!!loading || renewDisabled}
                    className="w-full py-2.5 rounded-xl text-xs font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 inline-flex items-center justify-center gap-1.5 text-white"
                    style={{ background: "linear-gradient(90deg, #3b82f6, #2563eb)" }}
                  >
                    {loading ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Redirecting…</>) : (<>Renew now</>)}
                  </button>
                  {renewDisabled && (
                    <div className="text-center text-[11px] text-white/55">
                      Renew tersedia selepas tamat{expiryStr ? ` (${expiryStr})` : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={mode === "dashboard" ? onSelect : selectLivehostAndScrollToCheckout}
              disabled={!!loading}
              className="w-full py-3 rounded-xl text-sm font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-2 text-white"
              style={{ background: "linear-gradient(90deg, #3b82f6, #2563eb)" }}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</>
              ) : (
                <>Subscribe Livehost <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
