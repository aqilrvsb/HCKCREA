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

// Build the renderer env list DIRECTLY from app_settings (no fragile reference
// endpoint — that broke when the ref got deleted). Secrets come from app_settings
// (livehost_*), the flags are the proven NVENC/RIFE/watchdog config. This exact
// list booted + served /avatars (verified). Env-var NAMES match the bootstrap
// route + the renderer image.
async function buildLivehostEnvs(): Promise<{ key: string; value: string }[]> {
  const s = await getSettings([
    "livehost_turn_key_id", "livehost_turn_key_token", "livehost_minimax_key",
    "or_key", "novita_api_key", "livehost_hf_token", "livehost_box_secret",
  ]);
  const orRaw: any = s["or_key"];
  const orKey = orRaw && typeof orRaw === "object" ? (orRaw.key || "") : (orRaw || "");
  const hf = String(s["livehost_hf_token"] || "");
  return [
    { key: "CLOUDFLARE_TURN_KEY_ID", value: String(s["livehost_turn_key_id"] || "") },
    { key: "CLOUDFLARE_TURN_KEY_TOKEN", value: String(s["livehost_turn_key_token"] || "") },
    { key: "MINIMAX_API_KEY", value: String(s["livehost_minimax_key"] || "") },
    { key: "OPENROUTER_API_KEY", value: String(orKey) },
    { key: "OPENROUTER_MODEL", value: "openai/gpt-4.1" },
    { key: "NOVITA_API_KEY", value: String(s["novita_api_key"] || "") },
    { key: "HF_TOKEN", value: hf },
    { key: "HUGGING_FACE_HUB_TOKEN", value: hf },
    { key: "LIVEHOST_CONFIG_URL", value: "https://peninglab.com/api/livehost/engine-config" },
    { key: "LIVEHOST_BOX_SECRET", value: String(s["livehost_box_secret"] || "") },
    // NVENC on (caps=all + gate off), RIFE 50fps, B1 watchdog off (no false restarts).
    { key: "NVIDIA_DRIVER_CAPABILITIES", value: "all" },
    { key: "FORCE_NVENC", value: "0" },
    { key: "RIFE_FPS50", value: "1" },
    { key: "RENDERER_HEALTH_MAX_FAIL", value: "999999" },
  ];
}

type CreateResult = { ok: boolean; endpointId?: string; runsyncUrl?: string; error?: string };

// Create ONE serverless pool endpoint and insert it into livehost_pool.
export async function createPoolEndpoint(label?: string): Promise<CreateResult> {
  const admin = createAdminClient();
  const s = await getSettings(["novita_api_key"]);
  const key = s["novita_api_key"];
  if (!key) return { ok: false, error: "novita_api_key not set in app_settings" };

  try {
    const envs = await buildLivehostEnvs(); // from app_settings — no reference endpoint needed
    // Unique name; Novita names must be short + dns-ish.
    const name = "lh-pool-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const body = {
      endpoint: {
        name,
        // minNum:0 at CREATE = endpoint exists but NO worker = $0. Turn ON then
        // scales it to minNum:1 (worker runs, no timeout); Turn OFF scales back to
        // 0 (worker destroyed, endpoint kept). The endpoint is never deleted → the
        // cluster stays active → Turn ON is always reliable.
        workerConfig: { minNum: 0, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 },
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
    // RETRY on transient Novita errors. When the last endpoint is deleted the
    // serverless cluster idles → the next create returns "serverless cluster is
    // not active"; the cluster reactivates on retry. Also covers 429 rate-limit.
    // Up to ~8 tries over ~80s so a client's Turn ON just works (no user error).
    let endpointId = "";
    let lastErr = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      const d = await novita(`/endpoint/create`, key, { method: "POST", body: JSON.stringify(body) });
      endpointId = d?.id || d?.endpoint?.id || "";
      if (endpointId) break;
      lastErr = JSON.stringify(d).slice(0, 200);
      const transient = /not active|RATE_LIMIT|too many|429|unavailable|try again/i.test(lastErr);
      if (!transient || attempt === 5) break;
      await new Promise((r) => setTimeout(r, 8000)); // wait for the idled cluster to wake
    }
    if (!endpointId) return { ok: false, error: `create failed (cluster waking, cuba lagi): ${lastErr}` };

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

// Toggle an EXISTING endpoint's worker count (minNum) via /endpoint/update —
// WITHOUT deleting the endpoint. minNum:1 = worker runs; minNum:0 = worker
// destroyed ($0). The endpoint PERSISTS → the cluster never idles → Turn ON is
// always reliable. Novita's update needs the FULL config (flat body). Retries
// on transient errors.
export async function setEndpointWorkers(endpointId: string, minNum: number, freeTimeout = 1000): Promise<{ ok: boolean; error?: string }> {
  const key = (await getSettings(["novita_api_key"]))["novita_api_key"];
  if (!key) return { ok: false, error: "novita_api_key not set" };
  const g = await novita(`/endpoint?id=${endpointId}`, key);
  const cur = g?.endpoint || g;
  if (!cur?.name) return { ok: false, error: "endpoint not found" };
  const envs = await buildLivehostEnvs();
  const body = {
    id: endpointId, name: cur.name, clusterID: CLUSTER,
    workerConfig: { minNum, maxNum: 1, freeTimeout, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 },
    ports: [{ port: "8000" }],
    policy: { type: "queue", value: 4 },
    image: { image: IMAGE, authId: AUTH_ID, command: "" },
    envs,
    healthy: { path: "/ping" },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const d = await novita(`/endpoint/update`, key, { method: "POST", body: JSON.stringify(body) });
    if (!(d?.code || d?.reason)) return { ok: true };
    const msg = JSON.stringify(d);
    if (!/not active|RATE_LIMIT|too many|429|unavailable/i.test(msg) || attempt === 4) return { ok: false, error: msg.slice(0, 160) };
    await new Promise((r) => setTimeout(r, 6000));
  }
  return { ok: false, error: "update failed" };
}

// Turn a client's DEDICATED GPU on/off by TOGGLING the worker (minNum 1<->0).
// The endpoint is created ONCE and NEVER deleted (cluster stays active → Turn ON
// always reliable, not fragile).
//   on  → minNum:1 (worker spins up; first time creates the endpoint then scales
//         to 1). off → minNum:0 (worker DESTROYED → $0, endpoint stays).
//   Billing starts at RUNNING (gpu_on_at stamped when the worker first answers).
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
    if (!cfg?.gpu_allowed) return { ok: false, error: "GPU belum diberikan — sila buat pembayaran / hubungi admin." };
    const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single();
    if (Number(prof?.credits || 0) < minBalance) {
      return { ok: false, error: `Kredit < RM ${minBalance.toFixed(2)} — top up dahulu.` };
    }
    let endpointId = cfg?.gpu_endpoint_id || "";
    if (!endpointId) {
      // FIRST time → create the persistent endpoint (minNum:0, $0, no worker yet).
      const res = await createPoolEndpoint(`client:${userId.slice(0, 8)}`);
      if (!res.ok || !res.endpointId) return { ok: false, error: res.error || "GPU create failed" };
      endpointId = res.endpointId;
    }
    // spin the worker up (minNum:1) — no timeout while on
    const r = await setEndpointWorkers(endpointId, 1, 1000);
    if (!r.ok) return { ok: false, error: r.error || "GPU start failed" };
    const nowIso = new Date().toISOString();
    await admin.from("live_client_config").upsert({
      user_id: userId, gpu_on: true, gpu_on_at: null, gpu_endpoint_id: endpointId,
      backend_url: runsyncUrl(endpointId), updated_at: nowIso,
    });
    return { ok: true, on: true, endpointId, since: null };
  }

  // OFF — charge running time, then DESTROY THE WORKER (minNum:0) → $0. The
  // endpoint is NEVER deleted → next Turn ON is reliable (cluster stays active).
  if (!cfg?.gpu_on) return { ok: true, on: false, charged: 0 };
  const elapsed = cfg.gpu_on_at ? Math.max(0, (Date.now() - new Date(cfg.gpu_on_at).getTime()) / 1000) : 0;
  const charged = Number(((elapsed / 3600) * rateHour).toFixed(4));
  if (charged > 0) await deduct(userId, "gpu_session", charged);
  // OFF only: minNum:0 + freeTimeout:1s → the now-idle worker is removed in ~1s →
  // instant $0 (no 17-min lingering bill). This short timeout is set ONLY here, on
  // OFF — while streaming (ON) the config is minNum:1/freeTimeout:1000 and the
  // minimum worker is NEVER removed, so this can't terminate a live stream.
  if (cfg.gpu_endpoint_id) await setEndpointWorkers(cfg.gpu_endpoint_id, 0, 1);
  await admin.from("live_client_config").update({
    gpu_on: false, gpu_on_at: null, updated_at: new Date().toISOString(),
  }).eq("user_id", userId); // KEEP gpu_endpoint_id + backend_url — endpoint persists
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
