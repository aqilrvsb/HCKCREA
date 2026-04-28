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
    "p1_status_path",
  ]);
  return {
    base: s.p1_base?.url || "https://api.geminigen.ai",
    key: s.p1_key?.key || "",
    veoPath: s.p1_veo_path?.path || "/uapi/v1/video-gen/veo",
    grokPath: s.p1_grok_path?.path || "/uapi/v1/video-gen/grok",
    imagePath: s.p1_image_path?.path || "/uapi/v1/generate_image",
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
  asset: "image" | "video" | "cinema",
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

export async function getPlanRate(plan: string) {
  const v = await getSetting<any>(`plan_${plan}`);
  return {
    image: Number(v?.image_rate ?? 0.20),
    video: Number(v?.video_rate ?? 0.40),
  };
}
