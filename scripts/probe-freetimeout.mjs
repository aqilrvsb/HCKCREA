// Probe the max accepted freeTimeout. Creates a throwaway endpoint per value
// (deletes immediately on success). Spaced 8s to avoid Novita's create rate limit.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const clean = (v) => { let s = v; if (typeof s === "string") { try { const p = JSON.parse(s); if (typeof p === "string") s = p; } catch {} s = s.replace(/^"+|"+$/g, ""); } return s; };
async function novita(path, key, init) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  return await r.json().catch(() => ({}));
}
const { data: settings } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_pool_ref_endpoint"]);
const nkey = clean(settings.find((s) => s.key === "novita_api_key").value);
const ref = clean(settings.find((s) => s.key === "livehost_pool_ref_endpoint").value);
const envs = (await novita(`/endpoint?id=${ref}`, nkey))?.endpoint?.envs || [];

const values = [901, 1000, 1100, 1800];
for (const ft of values) {
  const name = "probe-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const body = { endpoint: { name, workerConfig: { minNum: 0, maxNum: 1, freeTimeout: ft, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, policy: { type: "queue", value: 4 }, image: { image: "docker.io/aqilrvsb/lh-avtr1:s9-nvenc2-chunk4", authId: "73068571-9b1d-44c6-a4d7-fb942614b1a4", command: "" }, rootfsSize: 90, products: [{ id: "SL-serverless-3" }], ports: [{ port: 8000 }], healthy: { path: "/ping" }, clusterIDs: ["as-sgp-2"], type: "sync", envs } };
  const d = await novita("/endpoint/create", nkey, { method: "POST", body: JSON.stringify(body) });
  const id = d?.id || d?.endpoint?.id;
  if (id) {
    console.log(`freeTimeout=${ft}  ACCEPTED (id ${id}) -> deleting`);
    await novita("/endpoint/delete", nkey, { method: "POST", body: JSON.stringify({ id }) });
  } else {
    console.log(`freeTimeout=${ft}  REJECTED: ${d?.reason || ""} ${d?.message || JSON.stringify(d).slice(0,120)}`);
  }
  await new Promise((r) => setTimeout(r, 8000));
}
console.log("probe done");
