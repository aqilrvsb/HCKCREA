import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, getSetting } from "@/lib/settings";
import { deduct } from "@/lib/deduct";

// Livehost endpoint POOL — a fixed set of single-worker 5090 serverless
// endpoints shared across all Livehost clients via round-robin (assign on Play,
// release on Stop). Each is the proven NVENC image, minNum:0 (=$0 idle),
// maxNum:1 + maxConcurrent:1 (=one sticky worker per session, which Novita's
// non-affinity load balancer requires for our stateful WebRTC streams).
//
// Endpoints are created by copying the env vars from a live reference endpoint
// (default 858ca6049ae91b38, the meow MAIN) so TURN/MINIMAX/OPENROUTER/LIVEHOST_*
// stay in one place and never get hardcoded here.

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s12-watchdog"; // inject-at-boundary (no discard): greeting/comment queue at sentence boundary
const AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4"; // dockerhub cred
const PRODUCT = "SL-serverless-3"; // RTX 5090 serverless
const CLUSTER = "as-sgp-2";
const DEFAULT_REF = "bc1a5ea6ae5677df"; // a live pool endpoint to copy envs from (app_settings.livehost_pool_ref_endpoint overrides)

export function runsyncUrl(endpointId: string): string {
  return `https://${endpointId}-${endpointId}.runsync.novita.dev`;
}

async function novita(path: string, key: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  return d;
}

// Pull the env var list from the reference endpoint so a new pool endpoint
// inherits the exact same secrets/config as the proven live one.
async function referenceEnvs(key: string, refId: string): Promise<any[]> {
  const d = await novita(`/endpoint?id=${refId}`, key);
  const envs = d?.endpoint?.envs;
  if (!Array.isArray(envs) || envs.length === 0) {
    throw new Error(`reference endpoint ${refId} returned no envs`);
  }
  // NVIDIA_DRIVER_CAPABILITIES=all → full access to the GPU's NVENC video engine
  // so the encoder (which ALWAYS tries h264_nvenc first) opens NVENC on as many
  // nodes as possible — this is the real NVENC lever, not the gate.
  const cap = envs.find((e: any) => e.key === "NVIDIA_DRIVER_CAPABILITIES");
  if (cap) cap.value = "all"; else envs.push({ key: "NVIDIA_DRIVER_CAPABILITIES", value: "all" });
  // FORCE_NVENC=0 → gate OFF. The gate (=1) made cold start hang 8-9min (tested).
  // Off = fast, stable boot; the encoder still uses NVENC whenever caps allow it.
  const fn = envs.find((e: any) => e.key === "FORCE_NVENC");
  if (fn) fn.value = "0"; else envs.push({ key: "FORCE_NVENC", value: "0" });
  // RIFE_FPS50=1 → AI frame-interpolation 25→50fps (no-lag 1-frame-delay pipeline)
  // = visibly smoother motion. Slightly softer (same 6Mbps over 2x frames).
  const rife = envs.find((e: any) => e.key === "RIFE_FPS50");
  if (rife) rife.value = "1"; else envs.push({ key: "RIFE_FPS50", value: "1" });
  // B1 renderer hang-watchdog DISABLED: it false-restarted healthy-but-BUSY workers
  // mid-stream (renderer busy with inference can't answer /health in 3s → 3 misses
  // → kills the worker → disconnect + 7min cold-reboot = "connecting forever").
  // Absurdly high ceiling = never tears down a live. Re-enable only with a
  // load-safe design (poll lightweight /ping, lenient counts).
  const hw = envs.find((e: any) => e.key === "RENDERER_HEALTH_MAX_FAIL");
  if (hw) hw.value = "999999"; else envs.push({ key: "RENDERER_HEALTH_MAX_FAIL", value: "999999" });
  return envs;
}

type CreateResult = { ok: boolean; endpointId?: string; runsyncUrl?: string; error?: string };

// Create ONE serverless pool endpoint and insert it into livehost_pool.
export async function createPoolEndpoint(label?: string): Promise<CreateResult> {
  const admin = createAdminClient();
  const s = await getSettings(["novita_api_key", "livehost_pool_ref_endpoint"]);
  const key = s["novita_api_key"];
  if (!key) return { ok: false, error: "novita_api_key not set in app_settings" };
  const refId = s["livehost_pool_ref_endpoint"] || DEFAULT_REF;

  try {
    const envs = await referenceEnvs(key, refId);
    // Unique name; Novita names must be short + dns-ish.
    const name = "lh-pool-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const body = {
      endpoint: {
        name,
        // minNum:1 = ALWAYS-ON (1 GPU per client). Keeps the worker permanently so
        // Novita's freeTimeout never removes it mid-stream (WebRTC sends no HTTP
        // requests → it would otherwise be killed ~16.7min in). No restart cycle →
        // no mid-live disconnect. Always billed; host limits client count.
        workerConfig: { minNum: 1, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 },
        policy: { type: "queue", value: 4 },
        image: { image: IMAGE, authId: AUTH_ID, command: "" },
        rootfsSize: 90,
        products: [{ id: PRODUCT }],
        ports: [{ port: 8000 }],
        healthy: { path: "/ping" },
        clusterIDs: [CLUSTER],
        type: "sync",
        envs,
      },
    };
    const d = await novita(`/endpoint/create`, key, { method: "POST", body: JSON.stringify(body) });
    const endpointId = d?.id || d?.endpoint?.id;
    if (!endpointId) return { ok: false, error: `create failed: ${JSON.stringify(d).slice(0, 200)}` };

    const url = runsyncUrl(endpointId);
    const { error: insErr } = await admin.from("livehost_pool").insert({
      endpoint_id: endpointId,
      runsync_url: url,
      label: label || name,
      status: "free",
    });
    if (insErr) return { ok: false, endpointId, runsyncUrl: url, error: `created but DB insert failed: ${insErr.message}` };
    return { ok: true, endpointId, runsyncUrl: url };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}



// Create N endpoints sequentially (Novita create is fast; keep it serial to be
// gentle on rate limits and surface the first failure clearly).
export async function createPoolEndpoints(count: number): Promise<CreateResult[]> {
  const out: CreateResult[] = [];
  const n = Math.max(1, Math.min(50, count));
  for (let i = 0; i < n; i++) {
    out.push(await createPoolEndpoint());
    // Novita rate-limits rapid creates (429) — pace them out.
    if (i < n - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}

function rateNum(v: unknown, fallback: number): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type GpuToggle = {
  ok: boolean; error?: string; on?: boolean; charged?: number;
  endpointId?: string; since?: string | null;
};

// Turn a client's DEDICATED GPU on/off (single source of truth for the money
// logic — used by both the client Billing route and the admin route).
//   on  → create a minNum:1 endpoint, bind it to the user, stamp gpu_on_at
//         (requires credits ≥ min-balance). Always-on = no mid-stream disconnect.
//   off → charge elapsed × livehost_gpu_rate_hour (mechanism A), delete the
//         endpoint ($0), clear the binding.
export async function setClientGpu(userId: string, on: boolean): Promise<GpuToggle> {
  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("gpu_on, gpu_on_at, gpu_endpoint_id, gpu_allowed")
    .eq("user_id", userId)
    .maybeSingle();
  const rateHour = rateNum(await getSetting<string>("livehost_gpu_rate_hour"), 6);
  const minBalance = rateNum(await getSetting<string>("livehost_min_balance"), 5);

  if (on) {
    if (cfg?.gpu_on) return { ok: true, on: true, endpointId: cfg.gpu_endpoint_id || undefined, since: cfg.gpu_on_at };
    // Admin must "appoint" this client first (1 GPU = 1 client, admin-gated).
    if (!cfg?.gpu_allowed) return { ok: false, error: "GPU belum diberikan oleh admin." };
    const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single();
    if (Number(prof?.credits || 0) < minBalance) {
      return { ok: false, error: `Kredit < RM ${minBalance.toFixed(2)} — top up dahulu.` };
    }
    const res = await createPoolEndpoint(`client:${userId.slice(0, 8)}`);
    if (!res.ok || !res.endpointId) return { ok: false, error: res.error || "GPU create failed" };
    const nowIso = new Date().toISOString();
    await admin.from("livehost_pool").update({
      status: "busy", assigned_user_id: userId, assigned_at: nowIso, updated_at: nowIso,
    }).eq("endpoint_id", res.endpointId);
    await admin.from("live_client_config").upsert({
      user_id: userId, gpu_on: true, gpu_on_at: nowIso, gpu_endpoint_id: res.endpointId,
      backend_url: res.runsyncUrl || "", updated_at: nowIso,
    });
    return { ok: true, on: true, endpointId: res.endpointId, since: nowIso };
  }

  // OFF
  if (!cfg?.gpu_on) return { ok: true, on: false, charged: 0 };
  const elapsed = cfg.gpu_on_at ? Math.max(0, (Date.now() - new Date(cfg.gpu_on_at).getTime()) / 1000) : 0;
  const charged = Number(((elapsed / 3600) * rateHour).toFixed(4));
  if (charged > 0) await deduct(userId, "gpu_session", charged);
  if (cfg.gpu_endpoint_id) await deletePoolEndpoint(cfg.gpu_endpoint_id);
  await admin.from("live_client_config").update({
    gpu_on: false, gpu_on_at: null, gpu_endpoint_id: null, backend_url: "",
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return { ok: true, on: false, charged };
}

// Delete an endpoint from Novita AND remove its pool row.
export async function deletePoolEndpoint(endpointId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const key = (await getSettings(["novita_api_key"]))["novita_api_key"];
  if (!key) return { ok: false, error: "novita_api_key not set" };
  try {
    await novita(`/endpoint/delete`, key, { method: "POST", body: JSON.stringify({ id: endpointId }) });
  } catch (e: any) {
    // Even if Novita delete fails, drop the row so it's not handed out.
    console.error("[pool] novita delete failed:", e?.message);
  }
  const { error } = await admin.from("livehost_pool").delete().eq("endpoint_id", endpointId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
