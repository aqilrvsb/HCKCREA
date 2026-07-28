"use client";

import { createClient } from "@/lib/supabase/client";
import { LockKeyhole, LogOut } from "lucide-react";
import BillingSection from "./sections/billing";

// Shown when a client's plan has expired (non-admin). Per user direction
// 2026-07-28: instead of a hard lock, expired clients CAN log in but only reach
// BILLING — so they can self-renew (Pro/Premium). Everything else (projects,
// generation tabs, other account pages) is unreachable because we render just
// the billing surface here, not the full dashboard shell.
export default function ExpiredBilling({
  name,
  plan,
  planExpiresAt,
}: {
  name: string;
  plan: string;
  planExpiresAt: string | null;
}) {
  async function logout() {
    try {
      const sb = createClient();
      await sb.auth.signOut();
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  const expiredOn = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Expired banner + logout — the ONLY nav an expired client gets. */}
      <div
        className="sticky top-0 z-20 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: "rgba(239,68,68,0.10)", borderBottom: "1px solid rgba(239,68,68,0.30)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)" }}
          >
            <LockKeyhole className="w-5 h-5 text-red-500" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[15px] text-[var(--color-text-primary)] leading-tight">
              Plan anda telah tamat{expiredOn ? ` — tamat ${expiredOn}` : ""}
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)] leading-tight">
              Hi {name}, langgan semula (Pro / Premium) di bawah untuk sambung guna PeningLab.
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition hover:brightness-110 flex-shrink-0"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
        >
          <LogOut className="w-4 h-4" /> Log keluar
        </button>
      </div>

      {/* Billing only — the plans grid + renew. Self-fetches the client's plan
          + payment history. No generation tabs are rendered anywhere. */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
        <BillingSection initialPlan={plan} />
      </div>
    </div>
  );
}
