import { createAdminClient } from "@/lib/supabase/admin";

// Read a single setting from app_settings. Returns the value JSON or null.
// Server-side only — uses service role.
export async function getSetting<T = any>(key: string): Promise<T | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as T) ?? null;
}

// Read multiple settings at once
export async function getSettings(
  keys: string[]
): Promise<Record<string, any>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("key,value")
    .in("key", keys);
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = null;
  (data || []).forEach((r: any) => {
    out[r.key] = r.value;
  });
  return out;
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
