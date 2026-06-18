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

// List the REAL serverless GPU endpoints we have on Novita (so admin assigns
// from reality — 1 client = 1 GPU). Each: { id, name, state }.
export async function listNovitaEndpoints(): Promise<{ id: string; name: string; state: string }[]> {
  const key = (await getSettings(["novita_api_key"]))["novita_api_key"];
  if (!key) return [];
  try {
    const d = await novita("/endpoints", key);
    const arr = d?.endpoints || d?.data || [];
    return (Array.isArray(arr) ? arr : [])
      .map((e: any) => {
        // Novita's state can be a string OR an object {state,error,message}.
        const raw = e.status ?? e.state ?? e.endpoint?.status;
        const state = typeof raw === "string" ? raw : String(raw?.state || "");
        return {
          id: e.id || e.endpoint?.id || "",
          name: e.name || e.endpoint?.name || "",
          state,
        };
      })
      .filter((e: { id: string }) => !!e.id);
  } catch {
    return [];
  }
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

  // Endpoints are admin-managed (created in the pool + assigned to a client via
  // the admin dropdown). on/off here just START/STOP the client's BILLING on
  // their ASSIGNED endpoint (which is always-on, minNum:1 → instant, no boot,
  // no disconnect). It does NOT create/delete endpoints.
  if (on) {
    if (cfg?.gpu_on) return { ok: true, on: true, endpointId: cfg.gpu_endpoint_id || undefined, since: cfg.gpu_on_at };
    // Admin must assign a GPU to this client first (1 GPU = 1 client, admin-gated).
    if (!cfg?.gpu_allowed || !cfg?.gpu_endpoint_id) {
      return { ok: false, error: "GPU belum di-assign oleh admin." };
    }
    const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single();
    if (Number(prof?.credits || 0) < minBalance) {
      return { ok: false, error: `Kredit < RM ${minBalance.toFixed(2)} — top up dahulu.` };
    }
    const nowIso = new Date().toISOString();
    // gpu_on_at stays NULL until the worker is actually RUNNING — billing starts
    // at running, NOT during the ~7min cold boot. The status poll sets gpu_on_at
    // the moment the worker first answers /avatars.
    await admin.from("live_client_config").update({
      gpu_on: true, gpu_on_at: null, backend_url: runsyncUrl(cfg.gpu_endpoint_id),
      updated_at: nowIso,
    }).eq("user_id", userId);
    // Kick the cold boot now (best-effort) so the worker starts spinning up.
    fetch(`${runsyncUrl(cfg.gpu_endpoint_id)}/avatars`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
    return { ok: true, on: true, endpointId: cfg.gpu_endpoint_id, since: null };
  }

  // OFF — charge the elapsed billed time; keep the endpoint assigned (admin owns
  // the endpoint lifecycle), the client can turn it on again any time.
  if (!cfg?.gpu_on) return { ok: true, on: false, charged: 0 };
  const elapsed = cfg.gpu_on_at ? Math.max(0, (Date.now() - new Date(cfg.gpu_on_at).getTime()) / 1000) : 0;
  const charged = Number(((elapsed / 3600) * rateHour).toFixed(4));
  if (charged > 0) await deduct(userId, "gpu_session", charged);
  await admin.from("live_client_config").update({
    gpu_on: false, gpu_on_at: null, updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return { ok: true, on: false, charged };
}

// Admin assigns a REAL Novita endpoint to a client (1 client = 1 GPU; no pool
// table). Source of truth = live_client_config.gpu_endpoint_id.
//   endpointId set → bind it (the client then turns it on/off at Usage).
//   endpointId "" → unassign: charge any running time, clear the binding.
export async function assignClientGpu(userId: string, endpointId: string): Promise<GpuToggle> {
  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("gpu_on, gpu_on_at, gpu_endpoint_id")
    .eq("user_id", userId)
    .maybeSingle();
  const rateHour = rateNum(await getSetting<string>("livehost_gpu_rate_hour"), 6);
  const nowIso = new Date().toISOString();

  const chargeIfOn = async () => {
    if (cfg?.gpu_on && cfg.gpu_on_at) {
      const el = Math.max(0, (Date.now() - new Date(cfg.gpu_on_at).getTime()) / 1000);
      const c = Number(((el / 3600) * rateHour).toFixed(4));
      if (c > 0) await deduct(userId, "gpu_session", c);
      return c;
    }
    return 0;
  };

  // ensure the client has a config row (backend_url is NOT NULL → "")
  const { data: exists } = await admin.from("live_client_config").select("user_id").eq("user_id", userId).maybeSingle();
  if (!exists) await admin.from("live_client_config").insert({ user_id: userId, backend_url: "", updated_at: nowIso });

  if (!endpointId) {
    const charged = await chargeIfOn();
    await admin.from("live_client_config").update({
      gpu_allowed: false, gpu_on: false, gpu_on_at: null, gpu_endpoint_id: null,
      backend_url: "", updated_at: nowIso,
    }).eq("user_id", userId);
    return { ok: true, on: false, charged };
  }

  // 1 GPU = 1 client: reject if this endpoint is already another client's.
  const { data: taken } = await admin.from("live_client_config")
    .select("user_id").eq("gpu_endpoint_id", endpointId).neq("user_id", userId).maybeSingle();
  if (taken) return { ok: false, error: "GPU ini sudah diberi client lain." };

  // switching endpoints → charge the old one's running time first
  if (cfg?.gpu_endpoint_id && cfg.gpu_endpoint_id !== endpointId) await chargeIfOn();

  await admin.from("live_client_config").update({
    gpu_allowed: true, gpu_on: false, gpu_on_at: null, gpu_endpoint_id: endpointId,
    backend_url: "", updated_at: nowIso,
  }).eq("user_id", userId);
  return { ok: true, on: false, endpointId };
}

// Delete an endpoint from Novita AND remove its pool row.

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
