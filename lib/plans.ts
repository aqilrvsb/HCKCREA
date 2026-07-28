// Plan registry — single source of truth for the 4 subscription tiers.
//
// PLAN_DEFAULTS values match what migration 0042 seeded into
// app_settings.plan_*. loadPlan() reads the live values from
// app_settings so admin can tune prices via /admin/settings without
// a redeploy, with PLAN_DEFAULTS as the fallback if a setting row
// is missing or malformed.

import type { SupabaseClient } from "@supabase/supabase-js";

// "livehost" is a SEPARATE package (RM500/mo) — it is a valid plan key
// (so checkout / subscribe / billing plumbing works) but it is NOT part of
// the 4-tier generation product: it has its own (currently blank) dashboard,
// grants no generation credits, and is rendered as its own card rather than
// inside the 4-tier grid. Use MARKETING_TIERS when you want only the 4
// generation tiers; use PLAN_KEYS for "is this a recognised plan string".
export const PLAN_KEYS = ["starter", "standard", "pro", "premium", "livehost"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

// The 4 generation tiers shown in the pricing grid / checkout radios.
// Excludes "livehost" (separate package, separate card + dashboard).
export const MARKETING_TIERS = ["starter", "standard", "pro", "premium"] as const;
export type MarketingTier = (typeof MARKETING_TIERS)[number];

// Tiers currently OFFERED for purchase in the pricing grid. Starter + Standard
// are RETIRED from sale per user direction 2026-07-28 — existing Starter/
// Standard subscribers keep their plan + features (PLAN_DEFAULTS still has
// them); only the purchase grid is limited to Pro/Premium.
export const OFFERED_TIERS: readonly MarketingTier[] = ["pro", "premium"];

export const LIVEHOST: PlanKey = "livehost";

export type PlanConfig = {
  price: number;   // RM per cycle
  days: number;    // cycle length
  credits: number; // RM credits granted on purchase
  label: string;   // user-facing capitalised name
};

export const PLAN_DEFAULTS: Record<PlanKey, PlanConfig> = {
  starter:  { price: 35,  days: 30, credits: 10,  label: "Starter" },
  standard: { price: 50,  days: 30, credits: 25,  label: "Standard" },
  pro:      { price: 120, days: 30, credits: 50,  label: "Pro" },
  premium:  { price: 200, days: 30, credits: 100, label: "Premium" },
  // Livehost — separate package; RM500/cycle includes RM200 usage credit
  // (spent on GPU live time + MiniMax voice). Top-up adds more anytime.
  livehost: { price: 500, days: 30, credits: 200, label: "Livehost" },
};

export const BEST_SELLER: MarketingTier = "pro";

export function isLivehost(plan: string | null | undefined): boolean {
  return plan === "livehost";
}

// Per-perk tier gates. Keep the source of truth here so pricing grid,
// sidebar, page-level guards, and the MCP auth check all agree.
export const TOPUP_TIERS: readonly PlanKey[] = ["pro", "premium", "livehost"];
export const MCP_TIERS: readonly PlanKey[] = ["pro", "premium"];
export const AFFILIATE_TIERS: readonly PlanKey[] = ["pro", "premium"];
export const AUTO_POST_TIERS: readonly PlanKey[] = ["standard", "pro", "premium"];
export const GROUP_VIP_TIERS: readonly PlanKey[] = ["premium"];

export function isPlanKey(s: unknown): s is PlanKey {
  return typeof s === "string" && (PLAN_KEYS as readonly string[]).includes(s);
}

// Convenience predicates — each takes the raw plan string (which may
// be null / "free" / a legacy value) and answers "can this user use
// this perk RIGHT NOW". They do NOT check plan_expires_at — caller
// is responsible for that (planActive guard).
export function canUseTopup(plan: string | null | undefined): boolean {
  return isPlanKey(plan) && (TOPUP_TIERS as readonly string[]).includes(plan);
}
export function canUseMcp(plan: string | null | undefined): boolean {
  return isPlanKey(plan) && (MCP_TIERS as readonly string[]).includes(plan);
}
export function canUseAffiliate(plan: string | null | undefined): boolean {
  return isPlanKey(plan) && (AFFILIATE_TIERS as readonly string[]).includes(plan);
}
export function canUseAutoPost(plan: string | null | undefined): boolean {
  return isPlanKey(plan) && (AUTO_POST_TIERS as readonly string[]).includes(plan);
}
export function canAccessGroupVip(plan: string | null | undefined): boolean {
  return isPlanKey(plan) && (GROUP_VIP_TIERS as readonly string[]).includes(plan);
}

export async function loadPlan(
  admin: SupabaseClient,
  key: PlanKey
): Promise<PlanConfig> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", `plan_${key}`)
    .maybeSingle();
  const v = (data?.value as Partial<PlanConfig> | null) || {};
  const d = PLAN_DEFAULTS[key];
  return {
    price:   Number(v.price   ?? d.price),
    days:    Number(v.days    ?? d.days),
    credits: Number(v.credits ?? d.credits),
    label:   String(v.label   ?? d.label),
  };
}
