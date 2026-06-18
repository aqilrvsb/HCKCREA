// One-off: clean slate for Plan C + give meow ONE fresh minNum:1 GPU (simulates
// "Turn ON"). Deletes ALL existing pool endpoints, creates 1 minNum:1 endpoint
// (latest image, envs from ref), binds it to meow, and prints its worker config
// so we can confirm minNum:1 (= Novita can never idle-kill it = NO timeout).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MEOW = "5c102586-f32b-4151-abb7-65b953788bce";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let x = v; if (typeof x === "string") { try { const p = JSON.parse(x); if (typeof p === "string") x = p; } catch {} x = x.replace(/^"+|"+$/g, ""); } return x; };
const { data: st } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_pool_ref_endpoint"]);
const nkey = clean(st.find((s) => s.key === "novita_api_key")?.value);
const ref = clean(st.find((s) => s.key === "livehost_pool_ref_endpoint")?.value) || "bc1a5ea6ae5677df";

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s12-watchdog";
const AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4";
const PRODUCT = "SL-serverless-3";
const CLUSTER = "as-sgp-2";
const runsyncUrl = (id) => `https://${id}-${id}.runsync.novita.dev`;
async function novita(path, init) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  return await r.json().catch(() => ({}));
}

// 1) List + delete ALL existing endpoints (clean slate → $0).
const list = await novita("/endpoints");
const eps = list?.endpoints || list?.data || [];
for (const e of eps) {
  const id = e.id || e.endpoint?.id;
  await novita("/endpoint/delete", { method: "POST", body: JSON.stringify({ id }) });
  console.log("deleted", id, e.name || "");
}
await sb.from("livehost_pool").delete().neq("endpoint_id", "");

// 2) Create 1 fresh minNum:1 endpoint (envs from ref, latest image).
const refData = await novita(`/endpoint?id=${ref}`);
const envs = refData?.endpoint?.envs || [];
const setEnv = (k, v) => { const e = envs.find((x) => x.key === k); if (e) e.value = v; else envs.push({ key: k, value: v }); };
setEnv("NVIDIA_DRIVER_CAPABILITIES", "all");
setEnv("FORCE_NVENC", "0");
setEnv("RIFE_FPS50", "1");
setEnv("RENDERER_HEALTH_MAX_FAIL", "999999");
const name = "lh-meow-" + Date.now().toString(36);
const body = { endpoint: { name, workerConfig: { minNum: 1, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, policy: { type: "queue", value: 4 }, image: { image: IMAGE, authId: AUTH_ID, command: "" }, rootfsSize: 90, products: [{ id: PRODUCT }], ports: [{ port: 8000 }], healthy: { path: "/ping" }, clusterIDs: [CLUSTER], type: "sync", envs } };
const d = await novita("/endpoint/create", { method: "POST", body: JSON.stringify(body) });
const id = d?.id || d?.endpoint?.id;
if (!id) { console.error("CREATE FAILED:", JSON.stringify(d).slice(0, 300)); process.exit(1); }
console.log("created minNum:1 endpoint:", id);

// 3) Bind to meow (Plan C "on": gpu_on=true, gpu_on_at=null → bills at running).
await sb.from("live_client_config").update({
  gpu_on: true, gpu_on_at: null, gpu_endpoint_id: id, gpu_allowed: true,
  backend_url: runsyncUrl(id), updated_at: new Date().toISOString(),
}).eq("user_id", MEOW);
await sb.from("livehost_pool").insert({ endpoint_id: id, runsync_url: runsyncUrl(id), label: "meow C", status: "busy", assigned_user_id: MEOW }).select();

// 4) Verify minNum:1.
const v = await novita(`/endpoint?id=${id}`);
const wc = v?.endpoint?.workerConfig || {};
console.log("VERIFY workerConfig:", JSON.stringify(wc));
console.log("minNum =", wc.minNum, "→", wc.minNum === 1 ? "ALWAYS-ON, NO timeout ✅" : "⚠ NOT minNum:1");
console.log("DONE. meow bound to", id, "(booting ~7min). URL:", runsyncUrl(id));
