// Create a minNum:1 endpoint (retry to wake the idled cluster), bind meow, then
// TEST whether minNum can be EDITED 1->0->1 (the "toggle worker" model).
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
const gg = (rows, k) => { const v = clean(rows.find((r) => r.key === k)?.value); return v && typeof v === "object" ? (v.key || "") : (v || ""); };
const { data: rows } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_turn_key_id", "livehost_turn_key_token", "livehost_minimax_key", "or_key", "livehost_hf_token", "livehost_box_secret"]);
const nkey = String(gg(rows, "novita_api_key"));
const hf = String(gg(rows, "livehost_hf_token"));
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s12-watchdog", AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4", PRODUCT = "SL-serverless-3", CLUSTER = "as-sgp-2";
const runsyncUrl = (id) => `https://${id}-${id}.runsync.novita.dev`;
const nv = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const envs = [
  { key: "CLOUDFLARE_TURN_KEY_ID", value: String(gg(rows, "livehost_turn_key_id")) },
  { key: "CLOUDFLARE_TURN_KEY_TOKEN", value: String(gg(rows, "livehost_turn_key_token")) },
  { key: "MINIMAX_API_KEY", value: String(gg(rows, "livehost_minimax_key")) },
  { key: "OPENROUTER_API_KEY", value: String(gg(rows, "or_key")) },
  { key: "OPENROUTER_MODEL", value: "openai/gpt-4.1" },
  { key: "NOVITA_API_KEY", value: nkey },
  { key: "HF_TOKEN", value: hf }, { key: "HUGGING_FACE_HUB_TOKEN", value: hf },
  { key: "LIVEHOST_CONFIG_URL", value: "https://peninglab.com/api/livehost/engine-config" },
  { key: "LIVEHOST_BOX_SECRET", value: String(gg(rows, "livehost_box_secret")) },
  { key: "NVIDIA_DRIVER_CAPABILITIES", value: "all" }, { key: "FORCE_NVENC", value: "0" }, { key: "RIFE_FPS50", value: "1" }, { key: "RENDERER_HEALTH_MAX_FAIL", value: "999999" },
];
const body = { endpoint: { name: "lh-meow-" + Date.now().toString(36), workerConfig: { minNum: 1, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, policy: { type: "queue", value: 4 }, image: { image: IMAGE, authId: AUTH_ID, command: "" }, rootfsSize: 90, products: [{ id: PRODUCT }], ports: [{ port: 8000 }], healthy: { path: "/ping" }, clusterIDs: [CLUSTER], type: "sync", envs } };

let id = "";
for (let i = 1; i <= 6; i++) {
  const d = await nv("/endpoint/create", { method: "POST", body: JSON.stringify(body) });
  id = d.body?.id || d.body?.endpoint?.id || "";
  if (id) { console.log("created", id, "on try", i); break; }
  console.log("try", i, "->", JSON.stringify(d.body).slice(0, 120));
  await new Promise((r) => setTimeout(r, 8000));
}
if (!id) { console.log("CREATE FAILED after retries"); process.exit(1); }

// bind meow
await sb.from("live_client_config").update({ gpu_on: true, gpu_on_at: null, gpu_endpoint_id: id, gpu_allowed: true, backend_url: runsyncUrl(id), updated_at: new Date().toISOString() }).eq("user_id", MEOW);
console.log("bound meow ->", id);

// TEST minNum edit — FLAT body, all params (per docs).
const g = await nv(`/endpoint?id=${id}`);
const ep = g.body?.endpoint || g.body;
const nm = ep.name || ("lh-meow-" + id.slice(0, 6));
console.log("\nTEST minNum edit (current=", ep.workerConfig?.minNum, ")");
const upd = (minNum) => ({
  id, name: nm, clusterID: CLUSTER,
  workerConfig: { minNum, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 },
  ports: [{ port: "8000" }],
  policy: { type: "queue", value: 4 },
  image: { image: IMAGE, authId: AUTH_ID, command: "" },
  envs,
  healthy: { path: "/ping" },
});
const u = await nv("/endpoint/update", { method: "POST", body: JSON.stringify(upd(0)) });
console.log(`update minNum->0 -> ${u.status} ${JSON.stringify(u.body).slice(0, 200)}`);
if (u.status === 200) {
  await new Promise((r) => setTimeout(r, 2500));
  const v = await nv(`/endpoint?id=${id}`);
  console.log("  minNum now:", (v.body?.endpoint || v.body)?.workerConfig?.minNum, "→ EDIT WORKS ✅ (toggle model viable)");
  const back = await nv("/endpoint/update", { method: "POST", body: JSON.stringify(upd(1)) });
  console.log("  set back minNum->1:", back.status);
} else {
  console.log("minNum EDIT NOT SUPPORTED ❌ — keep create/delete. meow stays minNum:1.");
}
