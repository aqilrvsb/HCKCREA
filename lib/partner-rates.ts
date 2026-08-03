// Partner pricing — the admin BASE rate per model (the floor a partner can
// never price below) + the resolver that applies a partner's marked-up rate.
//
// Units mirror lib/deduct.ts priceFor EXACTLY so the clamp is apples-to-apples:
//   • veo        → flat per-8s
//   • grok/seedance/sora2 → per-SECOND (settle multiplies by duration)
//   • gemini     → flat per-10s
//   • banana_pro/gpt_image → flat per-image
// A partner override is stored + compared in these same units.

import {
  getBananaProRate,
  getGptImageRate,
  getVeoRate,
  getGrokRate,
  getSeedanceRate,
  getGeminiRate,
  getSetting,
} from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isPartnerGroup,
  partnerSettingsKey,
  type PartnerConfig,
  type PartnerRateModel,
} from "@/lib/partners";

/** The partner group a CLIENT belongs to (from profiles.settings.managed_group),
 *  or null. One small profile read; used by priceFor to apply partner pricing. */
export async function clientPartnerGroup(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const g = (data?.settings as any)?.managed_group as string | undefined;
  return isPartnerGroup(g) ? (g as string) : null;
}

/** The platform BASE rate per model — the floor. */
export async function adminBaseRates(): Promise<Record<PartnerRateModel, number>> {
  const [banana, gpt, veo8, grok, seedance, gemini] = await Promise.all([
    getBananaProRate(),
    getGptImageRate(),
    getVeoRate("8"),
    getGrokRate(),
    getSeedanceRate(),
    getGeminiRate("10"),
  ]);
  // sora2 base mirrors priceFor: sora2_rate.rate, else grok/second × 2.
  const sora2cfg = await getSetting<{ rate: number }>("sora2_rate");
  const sora2 = typeof sora2cfg?.rate === "number" ? sora2cfg.rate : grok * 2;
  return { banana_pro: banana, gpt_image: gpt, veo: veo8, grok, seedance, sora2, gemini };
}

/** Load a partner's config (cached via getSetting's 60s cache). */
export async function getPartnerConfig(group: string | null): Promise<PartnerConfig | null> {
  if (!group || !isPartnerGroup(group)) return null;
  const cfg = await getSetting<PartnerConfig>(partnerSettingsKey(group));
  return cfg || null;
}

/** Apply a partner's per-model markup to a computed base rate, never going below
 *  the base (the admin floor). Returns baseRate unchanged when the client isn't a
 *  partner's client, no model hint is known, or no override is configured. */
export async function applyPartnerRate(
  group: string | null,
  model: PartnerRateModel | undefined | null,
  baseRate: number
): Promise<number> {
  if (!group || !isPartnerGroup(group) || !model) return baseRate;
  const cfg = await getSetting<PartnerConfig>(partnerSettingsKey(group));
  const override = cfg?.rates?.[model];
  if (typeof override !== "number" || !(override > 0)) return baseRate;
  return Math.max(baseRate, override); // floor at admin base — mark UP only
}
