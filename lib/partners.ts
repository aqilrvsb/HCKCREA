// PARTNER (white-label reseller) capability — a Manage-Users team that ALSO
// controls its clients' visible tabs + per-model pricing. A partner is a
// superset of a plain reseller team: everything nl-team can do, plus a
// per-partner config blob (visible_tabs + rates) stored in app_settings.
//
// v1 hardcodes HQNL (hqnl-team). Adding a 2nd partner later = one entry here +
// its manager email in MANAGE_USERS_TEAMS. Partners are NOT is_admin — they
// never reach the /admin console; authority is the same email-allowlist model
// as the reseller feature (lib/manage-users.ts).

import { manageUsersGroup } from "@/lib/manage-users";

// Teams that are PARTNERS (tab + pricing control). Subset of MANAGE_USERS_TEAMS.
export const PARTNER_TEAMS = ["hqnl-team"] as const;
export type PartnerGroup = (typeof PARTNER_TEAMS)[number];

// The model "rate slots" a partner may set a price for. Mirrors PriceModelHint
// in lib/deduct.ts (the keys priceFor resolves a per-model rate from).
export const PARTNER_RATE_MODELS = [
  "banana_pro",
  "gpt_image",
  "veo",
  "grok",
  "seedance",
  "sora2",
  "gemini",
] as const;
export type PartnerRateModel = (typeof PARTNER_RATE_MODELS)[number];

// Per-partner config, stored in app_settings under partnerSettingsKey(group).
export type PartnerConfig = {
  // TabKeys the partner's clients may see. undefined/empty = all tabs allowed
  // (no restriction yet configured). Only the project tabs are gated.
  visible_tabs?: string[];
  // Per-model rate overrides. Each is clamped to >= the admin base rate at both
  // save time and resolution time, so a partner can only mark UP, never undercut.
  rates?: Partial<Record<PartnerRateModel, number>>;
};

export function isPartnerGroup(group?: string | null): group is PartnerGroup {
  return !!group && (PARTNER_TEAMS as readonly string[]).includes(group);
}

/** The partner group a MANAGER email owns (null if not a partner manager). */
export function partnerGroupForManager(email?: string | null): PartnerGroup | null {
  const g = manageUsersGroup(email);
  return isPartnerGroup(g) ? g : null;
}

/** True if this email is a partner MANAGER (e.g. hqnl@gmail.com). */
export function isPartnerManager(email?: string | null): boolean {
  return partnerGroupForManager(email) !== null;
}

/** The partner group a CLIENT belongs to, read from their
 *  profiles.settings.managed_group (null if not a partner's client). */
export function partnerGroupForClient(managedGroup?: string | null): PartnerGroup | null {
  return isPartnerGroup(managedGroup) ? (managedGroup as PartnerGroup) : null;
}

/** app_settings key holding a partner's config { visible_tabs, rates }.
 *  hqnl-team → "partner_hqnl_team". */
export function partnerSettingsKey(group: string): string {
  return `partner_${group.replace(/-/g, "_")}`;
}
