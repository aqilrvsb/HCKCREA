import { createAdminClient } from "@/lib/supabase/admin";

// In-memory cache. settings change only via /admin (rare). 60s TTL means
// a stale read window of ≤60s is acceptable. Cache lives per Vercel function
// instance — across cold starts it gets re-warmed.
const cache = new Map<string, { value: any; expiresAt: number }>();
const TTL_MS = 60_000;

export async function getSetting<T = any>(key: string): Promise<T | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = (data?.value ?? null) as T | null;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function getSettings(keys: string[]): Promise<Record<string, any>> {
  // Resolve cached keys without a DB call; only fetch the missing ones.
  const out: Record<string, any> = {};
  const missing: string[] = [];
  const now = Date.now();
  for (const k of keys) {
    const c = cache.get(k);
    if (c && c.expiresAt > now) out[k] = c.value;
    else missing.push(k);
  }
  if (missing.length === 0) return out;

  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", missing);
  for (const k of missing) {
    const row = data?.find((r: any) => r.key === k);
    const v = row?.value ?? null;
    out[k] = v;
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
  }
  return out;
}

// Helper for /admin update path — call this after writing to app_settings
// so the next read sees the new value immediately instead of waiting for TTL.
export function invalidateSettingsCache(keys?: string[]): void {
  if (!keys) {
    cache.clear();
    return;
  }
  for (const k of keys) cache.delete(k);
}

// Convenience helpers for the providers we use server-side
export async function getP2Config() {
  const s = await getSettings([
    "p2_base",
    "p2_key",
    "p2_key_b",
    "p2_create_path",
    "p2_status_path",
    "p2_model_t2v",
    "p2_model_i2v",
    "p2_model_r2v",
    "p2_model_grok_t2v",
    "p2_model_grok_i2v",
    "image_default",
    "image_models",
  ]);
  return {
    base: s.p2_base?.url || "",
    key: s.p2_key?.key || "",
    // Second Crun.ai API key — used as tier-2 fallback in the video
    // cascade. Same provider, different account, so per-account rate
    // limits / quota issues on account A don't block generation.
    keyB: s.p2_key_b?.key || "",
    createPath: s.p2_create_path?.path || "/api/v1/client/job/CreateTask",
    statusPath: s.p2_status_path?.path || "/api/v1/client/job/TaskInfo",
    videoT2V: s.p2_model_t2v?.model || "",
    videoI2V: s.p2_model_i2v?.model || "",
    videoR2V: s.p2_model_r2v?.model || "",
    grokT2V: s.p2_model_grok_t2v?.model || "grok-imagine/t2v",
    grokI2V: s.p2_model_grok_i2v?.model || "grok-imagine/i2v",
    imageDefault: s.image_default?.model || "nano-banana-pro",
    imageModels: s.image_models || {},
  };
}

// Affiliate / referral commission rate (admin-tunable, percent of every
// subscription payment paid out to the referrer). Default 20%.
export async function getReferralCommissionRate(): Promise<number> {
  const v = await getSetting<any>("referral_commission_rate");
  const n = Number(v?.rate);
  if (!Number.isFinite(n) || n < 0) return 20;
  return Math.min(100, n);
}

// Viral (Talking Object) image config — provider + model are admin-tuned
// independently of the global image_default so the Viral tab can run on
// a different model/provider without affecting Image / Storytelling tabs.
//   viral_provider     = { provider: "p1" | "p2" | "p3" | "p4" | "p5" }   (default p4)
//   viral_image_model  = { model: "nano-banana-pro" | ... } (default cfg.imageDefault)
// p3 = Mountsea path (forced nano-banana-fast — model dropdown is ignored).
// p4 = Grsai path (image cascade partner of p2).
export type ViralImageConfig = {
  provider: "p1" | "p2" | "p3" | "p4" | "p5";
  modelKey: string; // admin-side key (e.g. "nano-banana-pro")
};
export async function getViralImageConfig(): Promise<ViralImageConfig> {
  const [providerRow, modelRow, p2Cfg] = await Promise.all([
    getSetting<{ provider: "p1" | "p2" | "p3" | "p4" | "p5" }>("viral_provider"),
    getSetting<{ model: string }>("viral_image_model"),
    getP2Config(),
  ]);
  const p = providerRow?.provider;
  const provider: "p1" | "p2" | "p3" | "p4" | "p5" =
    p === "p1" || p === "p2" || p === "p3" || p === "p5" ? p : "p4";
  const modelKey = (modelRow?.model || p2Cfg.imageDefault || "nano-banana-pro").trim();
  return { provider, modelKey };
}

// Storytelling pricing — admin-tuned in /admin/settings. Defaults match
// the in-house rate sheet (RM 0.07 per scene image, RM 0.02 per second
// of MiniMax narration). Total cost per render:
//   (per_image × scene_count) + (per_audio_sec × scene_dur × scene_count)
export type StorytellingPricing = { per_image: number; per_audio_sec: number };
export async function getStorytellingPricing(): Promise<StorytellingPricing> {
  const v = await getSetting<any>("storytelling_pricing");
  const perImage = Number(v?.per_image);
  const perAudioSec = Number(v?.per_audio_sec);
  return {
    per_image: Number.isFinite(perImage) && perImage >= 0 ? perImage : 0.07,
    per_audio_sec: Number.isFinite(perAudioSec) && perAudioSec >= 0 ? perAudioSec : 0.02,
  };
}

// Storytelling narration playback speed — clamped 0.5–2.0 to match
// browser <audio>.playbackRate limits and the live preview slider. The
// AI Call project ran 1.2x because slightly faster reads more energetic
// over a phone line; for storytelling video a touch faster keeps
// scrolly viewers engaged without sounding rushed.
export async function getStorytellingVoiceSpeed(): Promise<number> {
  const v = await getSetting<any>("storytelling_voice_speed");
  const n = Number(v?.speed ?? v?.value);
  if (!Number.isFinite(n)) return 1.2;
  return Math.max(0.5, Math.min(2.0, n));
}

// Cinema (Grok Imagine) per-second pricing. Stored as { rate: number } in
// app_settings; admin tunes in /admin. Default 0.03 RM/sec ≈ RM 0.18 for 6s,
// RM 0.90 for 30s.
export async function getCinemaRate(): Promise<number> {
  const v = await getSetting<any>("cinema_rate_per_sec");
  const n = Number(v?.rate ?? v?.value ?? 0.03);
  return Number.isFinite(n) && n > 0 ? n : 0.03;
}

// P1 — GeminiGen.AI config. Sister of getP2Config. Admin can flip
// gen_provider_<asset> between "p1" and "p2" to rotate backends per asset
// type without redeploying. Endpoint paths are configurable in case
// GeminiGen rotates their routes.
export async function getP1Config() {
  const s = await getSettings([
    "p1_base",
    "p1_key",
    "p1_veo_path",
    "p1_grok_path",
    "p1_image_path",
    "p1_seedance_path",
    "p1_status_path",
  ]);
  return {
    base: s.p1_base?.url || "https://api.geminigen.ai",
    key: s.p1_key?.key || "",
    veoPath: s.p1_veo_path?.path || "/uapi/v1/video-gen/veo",
    grokPath: s.p1_grok_path?.path || "/uapi/v1/video-gen/grok",
    imagePath: s.p1_image_path?.path || "/uapi/v1/generate_image",
    seedancePath: s.p1_seedance_path?.path || "/uapi/v1/video-gen/seedance",
    statusPath: s.p1_status_path?.path || "/uapi/v1/history/{uuid}",
  };
}

// Active gen provider — drives which backend (p1 = GeminiGen, p2 = Crun.ai)
// receives the create-task call. Default p2 keeps existing deployments
// unchanged. Per-asset toggles (image / video / cinema) so a single
// outage on one asset doesn't cascade across the whole stack.
//
// VIDEO ONLY — supports a per-user override stored on profiles.video_provider.
// If the user picked a provider in their /settings page, that wins; else
// falls back to the admin's gen_provider_video setting. Image + Cinema
// stay admin-controlled across all users.
export type GenProvider = "p1" | "p2";

export async function getGenProvider(
  asset: "image" | "video" | "cinema" | "seedance",
  userId?: string
): Promise<GenProvider> {
  if (asset === "video" && userId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("video_provider")
      .eq("id", userId)
      .maybeSingle();
    const userPref = String(data?.video_provider || "").toLowerCase();
    if (userPref === "p1" || userPref === "p2") return userPref as GenProvider;
  }

  const v = await getSetting<any>(`gen_provider_${asset}`);
  const choice = String(v?.provider || "p2").toLowerCase();
  return choice === "p1" ? "p1" : "p2";
}

// TikHub config — TikTok / Douyin / TikTok Shop specialist with native
// Asian IPs. Pay-as-you-go from $0.001 / request. Used for TikTok URLs
// because Crawlbase's free tier can't reach TikTok Shop MY (region-locked).
export async function getTikHubConfig() {
  const s = await getSettings(["tikhub_base", "tikhub_token"]);
  return {
    base: s.tikhub_base?.url || "https://api.tikhub.io",
    token: s.tikhub_token?.key || "",
  };
}

// Crawlbase scraper config — used by /api/scrape/affiliate to pull
// product details from TikTok Shop / Shopee / Lazada affiliate URLs.
// Two tokens: normal (for static HTML + named scrapers like tiktok-shop)
// and JavaScript (for SPA-rendered pages where we fall back to og-meta /
// JSON-LD parsing).
export async function getCrawlbaseConfig() {
  const s = await getSettings([
    "crawlbase_base",
    "crawlbase_token",
    "crawlbase_token_js",
  ]);
  return {
    base: s.crawlbase_base?.url || "https://api.crawlbase.com",
    token: s.crawlbase_token?.key || "",
    tokenJs: s.crawlbase_token_js?.key || "",
  };
}

// P4 — Grsai (grsaiapi.com) config. Image-only provider, partner of p2
// in the image cascade. Key seeded via app_settings.p4_key.
export async function getP4Config() {
  const s = await getSettings(["p4_key", "p4_image_default"]);
  return {
    key: s.p4_key?.key || "",
    imageDefault: s.p4_image_default?.model || "nano-banana-pro",
  };
}

// P5 — APIMart (api.apimart.ai) config. Image + video provider. Used
// as a cascade slot for cross-vendor resilience. Key seeded via
// app_settings.p5_key. Model catalog: gpt-image-2, gemini-3-pro-image-preview
// (Banana Pro), gemini-3.1-flash-image-preview (Banana 2),
// gemini-2.5-flash-image-preview (Banana); veo3.1-fast/quality/lite;
// grok-imagine-1.0-video-apimart.
export async function getP5Config() {
  const s = await getSettings(["p5_key", "p5_image_default", "p5_video_default"]);
  return {
    key: s.p5_key?.key || "",
    imageDefault: s.p5_image_default?.model || "gemini-3-pro-image-preview",
    videoDefault: s.p5_video_default?.model || "veo3.1-fast",
  };
}

// RunningHub (P3) — used ONLY for hosting reference image uploads.
// Generation still goes through Crun.ai (P2). RH gives back a public CDN
// URL (download_url) that Crun.ai accepts as img_urls input. Mirrors
// the creative-hack-auto extension's rhUploadImage flow.
export async function getRunningHubConfig() {
  const s = await getSettings(["hc_rh_base", "hc_rh_key", "hc_rh_upload"]);
  return {
    base: s.hc_rh_base?.url || "https://www.runninghub.ai/openapi/v2",
    key: s.hc_rh_key?.key || "",
    uploadUrl:
      s.hc_rh_upload?.url ||
      "https://www.runninghub.cn/openapi/v2/media/upload/binary",
  };
}

export async function getCreditCosts() {
  const v = await getSetting<any>("credit_costs");
  return {
    image: Number(v?.image ?? 0.20),
    video_8s: Number(v?.video_8s ?? 0.40),
    video_16s: Number(v?.video_16s ?? 0.80),
    auto_plan: Number(v?.auto_plan ?? 0.10),
    clone_plan: Number(v?.clone_plan ?? 0.05),
  };
}

// Per-user project cap. Stored in app_settings as { value: N } so admins
// can change it from /admin without a deploy. Default 4 if missing.
export async function getProjectLimit(): Promise<number> {
  const v = await getSetting<any>("project_limit");
  const n = Number(v?.value ?? v?.limit ?? 4);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
}

// Seedance Fast — billed per second of video. Reads rate_seedance
// (the new per-model rate row) first; falls back to legacy seedance_rate
// for backward compat with deployments that ran 0018+0019 but not 0020.
// Default RM0.40 / sec.
export async function getSeedanceRate(): Promise<number> {
  const newRate = await getSetting<any>("rate_seedance");
  if (Number.isFinite(Number(newRate?.per_second)) && Number(newRate?.per_second) > 0) {
    return Number(newRate.per_second);
  }
  const legacy = await getSetting<any>("seedance_rate");
  const n = Number(legacy?.per_second ?? 0.40);
  return Number.isFinite(n) && n > 0 ? n : 0.40;
}

// ────────────────────────────────────────────────────────────────────
// Per-model rates — one knob per generation model so admin can price
// each independently. priceFor() / generation routes consult these
// first; absence falls through to the plan-tier rate. Migration 0020
// seeds defaults; 0019 keeps the old seedance_rate around as fallback.
// ────────────────────────────────────────────────────────────────────

export async function getBananaProRate(): Promise<number> {
  const v = await getSetting<any>("rate_banana_pro");
  const n = Number(v?.per_image);
  if (Number.isFinite(n) && n > 0) return n;
  const cost = await getCreditCosts();
  return cost.image;
}

export async function getGptImageRate(): Promise<number> {
  const v = await getSetting<any>("rate_gpt_image");
  const n = Number(v?.per_image);
  if (Number.isFinite(n) && n > 0) return n;
  const cost = await getCreditCosts();
  return cost.image;
}

export async function getVeoRate(durationMode: "8" | "16" = "8"): Promise<number> {
  const v = await getSetting<any>("rate_veo");
  const key = durationMode === "16" ? "per_video_16s" : "per_video_8s";
  const n = Number(v?.[key]);
  if (Number.isFinite(n) && n > 0) return n;
  const cost = await getCreditCosts();
  return durationMode === "16" ? cost.video_16s : cost.video_8s;
}

export async function getGrokRate(): Promise<number> {
  const v = await getSetting<any>("rate_grok");
  const n = Number(v?.per_second);
  if (Number.isFinite(n) && n > 0) return n;
  // Fall back to legacy cinema_rate.
  return await getCinemaRate();
}

export async function getPlanRate(plan: string) {
  const v = await getSetting<any>(`plan_${plan}`);
  return {
    image: Number(v?.image_rate ?? 0.20),
    video: Number(v?.video_rate ?? 0.40),
  };
}
