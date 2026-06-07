"use client";

import { CheckCircle2, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import {
  PLAN_KEYS,
  PLAN_DEFAULTS,
  BEST_SELLER,
  type PlanKey,
  type PlanConfig,
} from "@/lib/plans";

// Cross-component plumbing for the marketing-mode "Subscribe" click:
// we save the picked plan to sessionStorage and dispatch a custom event
// so the inline CheckoutForm can react without a full page navigation.
// Keys MUST match those used in app/(checkout)/checkout-form.tsx.
const SELECTED_PLAN_STORAGE_KEY = "peninglab:selected-plan";
const PLAN_CHANGE_EVENT = "peninglab:plan-changed";

function selectPlanAndScrollToCheckout(key: PlanKey) {
  try {
    sessionStorage.setItem(SELECTED_PLAN_STORAGE_KEY, key);
    window.dispatchEvent(new Event(PLAN_CHANGE_EVENT));
  } catch {
    // sessionStorage blocked — checkout form will fall back to its
    // default plan, user can still re-pick from the radio cards.
  }
  const target = document.getElementById("checkout");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// 4-card pricing grid. Used in dashboard Billing tab AND landing page.
// The 4 plan configs come from PLAN_DEFAULTS so the marketing surface
// always renders SOMETHING even if app_settings is unreachable; the
// dashboard subscribe path re-fetches the live config server-side
// (via loadPlan in /api/billing/subscribe) before charging.

type Mode = "dashboard" | "marketing";

type Props = {
  mode: Mode;
  /** Current plan key from profiles.plan. Used to mark a card as active. */
  currentPlan?: string | null;
  /** ISO timestamp string of profiles.plan_expires_at. Used to detect
   *  if the current plan is still active. */
  currentExpiry?: string | null;
  /** When set, the matching card shows a spinner + disabled state. */
  loading?: PlanKey | null;
  /** Dashboard mode only: parent handles the API call. */
  onSelect?: (key: PlanKey) => void;
};

// Marketing quote rates — used to derive the per-plan
// "boleh generate" numbers shown on each card. These match the
// public-facing rates ("Image 20 sen, video 40 sen"). If admin tunes
// real generate rates in app_settings, those still flow through the
// cascade — these constants are purely for marketing math.
const QUOTE_RATE_IMAGE_MYR = 0.20;
const QUOTE_RATE_VIDEO_MYR = 0.40;

const FEATURE_LINES = [
  "Image AI — 20 sen / generate",
  "Video AI — 40 sen / 8s",
  "Unlimited generate (within credit balance)",
  "Auto Content, Clone Video, Story Telling",
  "MCP API access (peninglab-mcp npm)",
  "Group VIP support",
];

function tierAccent(key: PlanKey): {
  border: string;
  badgeBg: string;
  badgeText: string;
  cta: string;
  highlight: boolean;
} {
  const highlight = key === BEST_SELLER;
  if (highlight) {
    return {
      border: "rgba(250, 204, 21, 0.55)",
      badgeBg: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
      badgeText: "#000",
      cta: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
      highlight,
    };
  }
  return {
    border: "rgba(255,87,34,0.25)",
    badgeBg: "rgba(255,87,34,0.10)",
    badgeText: "var(--color-orange)",
    cta: "linear-gradient(90deg, #f97316 0%, #ea580c 100%)",
    highlight,
  };
}

export default function PricingTiersGrid({
  mode,
  currentPlan,
  currentExpiry,
  loading,
  onSelect,
}: Props) {
  const now = Date.now();
  const expiryMs = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const planActiveNow = !!currentPlan && expiryMs > now;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {PLAN_KEYS.map((key) => {
        const cfg: PlanConfig = PLAN_DEFAULTS[key];
        const accent = tierAccent(key);
        const isCurrent = planActiveNow && currentPlan === key;
        const isLoading = loading === key;
        const quoteVideos = Math.floor(cfg.credits / QUOTE_RATE_VIDEO_MYR);
        const quoteImages = Math.floor(cfg.credits / QUOTE_RATE_IMAGE_MYR);

        return (
          <div
            key={key}
            className={`relative rounded-3xl p-6 flex flex-col gap-4 transition ${
              accent.highlight ? "scale-100 lg:scale-[1.03]" : ""
            }`}
            style={{
              background: "var(--color-bg-elev)",
              border: `2px solid ${accent.border}`,
              boxShadow: accent.highlight
                ? "0 12px 32px rgba(250,204,21,0.18)"
                : "0 4px 16px rgba(0,0,0,0.05)",
            }}
          >
            {accent.highlight && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                style={{
                  background: accent.badgeBg,
                  color: accent.badgeText,
                  boxShadow: "0 4px 12px rgba(250,204,21,0.35)",
                }}
              >
                ★ Best Seller
              </div>
            )}

            <div>
              <div
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
                style={{ background: accent.badgeBg, color: accent.badgeText }}
              >
                <Sparkles className="w-3 h-3" />
                {cfg.label}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-display font-extrabold text-4xl tracking-tight">
                  RM{cfg.price}
                </span>
                <span className="text-sm text-[var(--color-text-muted)]">
                  /{cfg.days} hari
                </span>
              </div>
              <div
                className="mt-1 text-sm font-semibold"
                style={{
                  // accent.badgeText is tuned for INSIDE the amber chip
                  // (black on Pro). This line sits OUTSIDE the chip on the
                  // card's dark background — needs a bright color instead.
                  color: accent.highlight ? "#fbbf24" : "var(--color-orange)",
                }}
              >
                + RM {cfg.credits} credits
              </div>
            </div>

            {/* "Boleh generate" math callout — converts the credit
                allotment into video / image counts using the public
                marketing rates. Big visible numbers drive conversion. */}
            <div
              className="p-3 rounded-xl"
              style={{
                background: accent.badgeBg,
                border: `1px solid ${accent.border}`,
              }}
            >
              <div
                className="text-[10px] uppercase tracking-wider font-bold mb-1.5"
                style={{ color: accent.badgeText }}
              >
                Boleh generate
              </div>
              <div
                className="flex items-baseline gap-1.5"
                style={{ color: accent.badgeText }}
              >
                <span className="font-display font-extrabold text-lg leading-none">
                  ~{quoteVideos}
                </span>
                <span className="text-[11px] opacity-75">video AI</span>
                <span className="mx-1 opacity-50">·</span>
                <span className="font-display font-extrabold text-lg leading-none">
                  ~{quoteImages}
                </span>
                <span className="text-[11px] opacity-75">image AI</span>
              </div>
            </div>

            <div className="flex-1 space-y-2">
              {FEATURE_LINES.map((line) => (
                <div key={line} className="flex items-start gap-2 text-[12px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-[var(--color-text-secondary)]">{line}</span>
                </div>
              ))}
            </div>

            {isCurrent ? (
              <div className="flex flex-col gap-2">
                <div
                  className="text-center py-2 rounded-xl text-xs font-bold uppercase tracking-wider"
                  style={{
                    background: "rgba(16,185,129,0.10)",
                    color: "#10b981",
                    border: "1px solid rgba(16,185,129,0.25)",
                  }}
                >
                  Current Plan
                </div>
                {mode === "dashboard" && onSelect && (
                  <button
                    onClick={() => onSelect(key)}
                    disabled={!!loading}
                    className="w-full py-2.5 rounded-xl text-xs font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                    style={{ background: accent.cta, color: "#000" }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Redirecting…
                      </>
                    ) : (
                      <>Renew now</>
                    )}
                  </button>
                )}
              </div>
            ) : mode === "dashboard" && onSelect ? (
              <button
                onClick={() => onSelect(key)}
                disabled={!!loading}
                className="w-full py-3 rounded-xl text-sm font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                style={{ background: accent.cta, color: "#000" }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    Subscribe
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => selectPlanAndScrollToCheckout(key)}
                className="w-full py-3 rounded-xl text-sm font-extrabold transition-transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
                style={{ background: accent.cta, color: "#000" }}
              >
                Subscribe
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
