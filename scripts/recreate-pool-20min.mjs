// One-off: recreate the 4 Livehost pool endpoints at freeTimeout=1200 (20 min).
// Novita rejects workerConfig edits, so we DELETE+CREATE. Order: create new
// (copying envs from the still-live ref) -> repoint ref -> delete old.
// Reads creds from .env.local + app_settings; prints only endpoint IDs.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!sbUrl || !sbKey) { console.error("missing supabase env in .env.local"); process.exit(1); }
const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s9-smooth1";
const AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4";
const PRODUCT = "SL-serverless-3";
const CLUSTER = "as-sgp-2";
const runsyncUrl = (id) => `https://${id}-${id}.runsync.novita.dev`;

async function novita(path, key, init) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  return await r.json().catch(() => ({}));
}

const { data: settings } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_pool_ref_endpoint"]);
const get = (k) => settings.find((s) => s.key === k)?.value;
const clean = (v) => { let s = v; if (typeof s === "string") { try { const p = JSON.parse(s); if (typeof p === "string") s = p; } catch {} s = s.replace(/^"+|"+$/g, ""); } return s; };
const nkey = clean(get("novita_api_key"));
const ref = clean(get("livehost_pool_ref_endpoint"));
if (!nkey) { console.error("no novita_api_key"); process.exit(1); }
console.log("ref endpoint:", ref);

const refData = await novita(`/endpoint?id=${ref}`, nkey);
const envs = refData?.endpoint?.envs;
if (!Array.isArray(envs) || !envs.length) { console.error("no ref envs:", JSON.stringify(refData).slice(0, 300)); process.exit(1); }
const have = new Set(envs.map((e) => e.key));
if (!have.has("NVIDIA_DRIVER_CAPABILITIES")) envs.push({ key: "NVIDIA_DRIVER_CAPABILITIES", value: "compute,utility,video" });
if (!have.has("FORCE_NVENC")) envs.push({ key: "FORCE_NVENC", value: "1" });
console.log("copied", envs.length, "envs from ref");

const { data: oldRows } = await sb.from("livehost_pool").select("endpoint_id");
const oldIds = (oldRows || []).map((r) => r.endpoint_id);
console.log("old endpoints:", oldIds);

const created = [];
for (let i = 0; i < 4; i++) {
  const name = "lh-pool-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const body = { endpoint: { name, workerConfig: { minNum: 0, maxNum: 1, freeTimeout: 1000, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, policy: { type: "queue", value: 4 }, image: { image: IMAGE, authId: AUTH_ID, command: "" }, rootfsSize: 90, products: [{ id: PRODUCT }], ports: [{ port: 8000 }], healthy: { path: "/ping" }, clusterIDs: [CLUSTER], type: "sync", envs } };
  const d = await novita("/endpoint/create", nkey, { method: "POST", body: JSON.stringify(body) });
  const id = d?.id || d?.endpoint?.id;
  if (!id) { console.error("create FAILED:", JSON.stringify(d).slice(0, 300)); continue; }
  await sb.from("livehost_pool").insert({ endpoint_id: id, runsync_url: runsyncUrl(id), label: "lh-pool max", status: "free" });
  created.push(id);
  console.log("created", id);
  if (i < 3) await new Promise((r) => setTimeout(r, 8000));
}
if (!created.length) { console.error("no endpoints created — aborting before delete"); process.exit(1); }

await sb.from("app_settings").update({ value: created[0] }).eq("key", "livehost_pool_ref_endpoint");
console.log("ref repointed ->", created[0]);

for (const id of oldIds) {
  await novita("/endpoint/delete", nkey, { method: "POST", body: JSON.stringify({ id }) });
  await sb.from("livehost_pool").delete().eq("endpoint_id", id);
  console.log("deleted old", id);
}

for (const id of created) {
  const d = await novita(`/endpoint?id=${id}`, nkey);
  console.log("verify", id, "freeTimeout=", d?.endpoint?.workerConfig?.freeTimeout);
}
console.log("DONE. new pool:", created.join(", "));
