// RECOVERY: rebuild a reference GPU endpoint with the full env list (names from
// the bootstrap route, values from app_settings), restore livehost_pool_ref_endpoint,
// and bind it to meow (Plan C "on"). Verifies minNum:1.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MEOW = "5c102586-f32b-4151-abb7-65b953788bce";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let x = v; if (typeof x === "string") { try { const p = JSON.parse(x); if (typeof p === "string") return p.replace(/^"+|"+$/g, ""); if (p && typeof p === "object") return p; } catch {} return x.replace(/^"+|"+$/g, ""); } return x; };

const keys = ["livehost_turn_key_id", "livehost_turn_key_token", "livehost_minimax_key", "or_key", "novita_api_key", "livehost_hf_token", "livehost_box_secret"];
const { data: rows } = await sb.from("app_settings").select("key,value").in("key", keys);
const g = (k) => clean(rows.find((r) => r.key === k)?.value);
const orRaw = g("or_key");
const orKey = (orRaw && typeof orRaw === "object") ? (orRaw.key || "") : (orRaw || "");
const nkey = String(g("novita_api_key") || "");
if (!nkey) { console.error("no novita_api_key"); process.exit(1); }

const envs = [
  { key: "CLOUDFLARE_TURN_KEY_ID", value: String(g("livehost_turn_key_id") || "") },
  { key: "CLOUDFLARE_TURN_KEY_TOKEN", value: String(g("livehost_turn_key_token") || "") },
  { key: "MINIMAX_API_KEY", value: String(g("livehost_minimax_key") || "") },
  { key: "OPENROUTER_API_KEY", value: String(orKey) },
  { key: "OPENROUTER_MODEL", value: "openai/gpt-4.1" },
  { key: "NOVITA_API_KEY", value: nkey },
  { key: "HF_TOKEN", value: String(g("livehost_hf_token") || "") },
  { key: "HUGGING_FACE_HUB_TOKEN", value: String(g("livehost_hf_token") || "") },
  { key: "LIVEHOST_CONFIG_URL", value: "https://peninglab.com/api/livehost/engine-config" },
  { key: "LIVEHOST_BOX_SECRET", value: String(g("livehost_box_secret") || "") },
  { key: "NVIDIA_DRIVER_CAPABILITIES", value: "all" },
  { key: "FORCE_NVENC", value: "0" },
  { key: "RIFE_FPS50", value: "1" },
  { key: "RENDERER_HEALTH_MAX_FAIL", value: "999999" },
];
console.log("env keys set:", envs.map((e) => `${e.key}=${e.value ? "✓" : "EMPTY"}`).join(" "));

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s12-watchdog";
const AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4";
const PRODUCT = "SL-serverless-3";
const CLUSTER = "as-sgp-2";
const runsyncUrl = (id) => `https://${id}-${id}.runsync.novita.dev`;
const nv = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json", ...(init?.headers || {}) } }); return await r.json().catch(() => ({})); };

const name = "lh-ref-" + Date.now().toString(36);
const body = { endpoint: { name, workerConfig: { minNum: 1, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, policy: { type: "queue", value: 4 }, image: { image: IMAGE, authId: AUTH_ID, command: "" }, rootfsSize: 90, products: [{ id: PRODUCT }], ports: [{ port: 8000 }], healthy: { path: "/ping" }, clusterIDs: [CLUSTER], type: "sync", envs } };
const d = await nv("/endpoint/create", { method: "POST", body: JSON.stringify(body) });
const id = d?.id || d?.endpoint?.id;
if (!id) { console.error("CREATE FAILED:", JSON.stringify(d).slice(0, 300)); process.exit(1); }
console.log("created endpoint:", id);

// restore the ref pointer so createPoolEndpoint can copy envs from this one
await sb.from("app_settings").upsert({ key: "livehost_pool_ref_endpoint", value: JSON.stringify(id), category: "livehost", updated_at: new Date().toISOString() });
// bind to meow (Plan C on)
await sb.from("live_client_config").update({ gpu_on: true, gpu_on_at: null, gpu_endpoint_id: id, gpu_allowed: true, backend_url: runsyncUrl(id), updated_at: new Date().toISOString() }).eq("user_id", MEOW);
await sb.from("livehost_pool").insert({ endpoint_id: id, runsync_url: runsyncUrl(id), label: "meow ref", status: "busy", assigned_user_id: MEOW });

const v = await nv(`/endpoint?id=${id}`);
console.log("verify minNum:", v?.endpoint?.workerConfig?.minNum);
console.log("DONE. ref + meow bound to", id, "| URL", runsyncUrl(id), "(booting ~7-25min first build)");
