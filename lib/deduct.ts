// Pre-flight credit checks + deduction. Image + Video deduction tracked in
// credit_transactions. auto_plan / clone_plan / signup_bonus deliberately
// excluded from "Usage" stats (per product decision).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCreditCosts,
  getPlanRate,
  getBananaProRate,
  getGptImageRate,
  getVeoRate,
  getGrokRate,
  getSeedanceRate,
} from "@/lib/settings";

export type DeductReason =
  | "image_generate"
  | "video_8s"
  | "video_16s"
  | "auto_plan"
  | "clone_plan"
  | "cinema"
  | "seedance"
  | "storytelling"
  | "template_body"
  | "gpu_session"
  | "animate"
  | "grok"
  | "scrape";

// Optional model hint to pick a per-model rate. Pass when the caller
// knows which provider/model the generation used so priceFor can read
// from rate_<model> in app_settings instead of falling back to the
// plan-tier rate. Backward compatible — omit and pricing works as before.
export type PriceModelHint =
  | "banana_pro"
  | "gpt_image"
  | "veo"
  | "grok"
  | "seedance"
  | "sora2"
  | "gemini";

// What rate applies for the given user + reason. Per-model rates
// (rate_banana_pro / rate_gpt_image / rate_veo / rate_grok / rate_seedance)
// take priority when the caller passes a model hint. Without a hint,
// falls back to plan-tier rates so existing call sites stay correct.
export async function priceFor(
  userId: string,
  reason: DeductReason,
  modelHint?: PriceModelHint
): Promise<number> {
  // Per-model rate path — bypasses plan tier entirely. Useful when the
  // caller knows which model produced the asset (e.g. extension, agent).
  if (modelHint === "banana_pro") return await getBananaProRate();
  if (modelHint === "gpt_image") return await getGptImageRate();
  if (modelHint === "veo") {
    return await getVeoRate(reason === "video_16s" ? "16" : "8");
  }
  if (modelHint === "grok") return await getGrokRate();
  if (modelHint === "seedance") return await getSeedanceRate();
  if (modelHint === "sora2") {
    // Sora 2 per-second rate. Admin sets sora2_rate; falls back to
    // cinema rate × 2 (matches /api/generate/cinema and /api/generate/sora2).
    const { getSetting } = await import("@/lib/settings");
    const cfg = await getSetting<{ rate: number }>("sora2_rate");
    if (typeof cfg?.rate === "number") return cfg.rate;
    return (await getGrokRate()) * 2;
  }
  if (modelHint === "gemini") {
    // GeminiOmni (Crun) — flat per-10s-video rate. Admin sets
    // rate_gemini.per_video_10s; falls back to Veo's 8s rate when
    // missing (rough proxy — Gemini's compute footprint is similar).
    const { getGeminiRate } = await import("@/lib/settings");
    return await getGeminiRate("10");
  }

  // Reason-based fallback paths preserved for backward compat.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  const plan = profile?.plan || "light";

  if (reason === "image_generate") {
    const rate = await getPlanRate(plan);
    return rate.image;
  }
  if (reason === "video_8s") {
    const rate = await getPlanRate(plan);
    return rate.video;
  }
  if (reason === "video_16s") {
    const rate = await getPlanRate(plan);
    return rate.video * 2;
  }
  if (reason === "cinema") return await getGrokRate();
  if (reason === "seedance") return await getSeedanceRate();
  const cost = await getCreditCosts();
  if (reason === "auto_plan") return cost.auto_plan;
  if (reason === "clone_plan") return cost.clone_plan;
  return 0;
}

export async function hasEnoughCredits(
  userId: string,
  amount: number
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  return Number(data?.credits || 0) >= amount;
}

// Combined hot-path helper: reads (plan, credits) from profiles in ONE query,
// then resolves the rate from cached settings. Replaces the sequential
// priceFor() + hasEnoughCredits() pattern in generate routes (saves one
// extra profiles round-trip per generation).
//
// amountOverride: pass a pre-computed cost (e.g. cinema's duration * rate)
//   instead of looking it up by reason.
export async function priceAndCheck(
  userId: string,
  reason: DeductReason,
  amountOverride?: number
): Promise<{ rate: number; hasFunds: boolean; plan: string; credits: number }> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, credits")
    .eq("id", userId)
    .single();
  const plan = profile?.plan || "light";
  const credits = Number(profile?.credits || 0);

  let rate: number;
  if (amountOverride !== undefined) {
    rate = amountOverride;
  } else if (reason === "image_generate") {
    const r = await getPlanRate(plan);
    rate = r.image;
  } else if (reason === "video_8s") {
    const r = await getPlanRate(plan);
    rate = r.video;
  } else if (reason === "video_16s") {
    const r = await getPlanRate(plan);
    rate = r.video * 2;
  } else {
    const cost = await getCreditCosts();
    rate = reason === "auto_plan" ? cost.auto_plan : reason === "clone_plan" ? cost.clone_plan : 0;
  }

  return { rate, hasFunds: credits >= rate, plan, credits };
}

export async function deduct(
  userId: string,
  reason: DeductReason,
  amount: number,
  historyId?: string
) {
  const admin = createAdminClient();

  // Atomic decrement via the decrement_credits RPC (migration 0009).
  // Pre-fix: a read-then-write pattern raced when two generations
  // finished simultaneously — both read the same `before` value, both
  // wrote the same `after`, and the second deduction silently no-op'd.
  // Symptom: two rows in credit_transactions with the same balance_after.
  // RPC does UPDATE … RETURNING in one statement so each caller sees
  // the actual post-decrement value.
  const { data: newBalance, error } = await admin.rpc("decrement_credits", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (error) {
    // Surface the SQL error so it's visible in Vercel logs. The settle
    // path swallows return values, so we don't throw here — the row will
    // still flip to done; just no deduction will land. The pg_cron poll
    // doesn't re-deduct on a row that's already done.
    console.error("[deduct] decrement_credits RPC failed:", error.message);
    return { before: 0, after: 0 };
  }

  const after = Number(newBalance ?? 0);
  const before = Math.max(after, after + amount);

  await admin.from("credit_transactions").insert({
    user_id: userId,
    amount: -amount,
    balance_after: after,
    reason,
    history_id: historyId || null,
    metadata: { rate: amount },
  });

  return { before, after };
}
