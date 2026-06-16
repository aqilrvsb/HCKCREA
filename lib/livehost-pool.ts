import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";

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
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s9-nvenc2-chunk"; // NVENC + gapless chunked sayaudio
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
  // Make sure NVENC stays on even if the reference ever drops it.
  const have = new Set(envs.map((e: any) => e.key));
  if (!have.has("NVIDIA_DRIVER_CAPABILITIES"))
    envs.push({ key: "NVIDIA_DRIVER_CAPABILITIES", value: "compute,utility,video" });
  if (!have.has("FORCE_NVENC")) envs.push({ key: "FORCE_NVENC", value: "1" });
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
        workerConfig: { minNum: 0, maxNum: 1, freeTimeout: 900, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 },
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
