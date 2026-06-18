// Turn EVERY Livehost GPU off ($0). Default state for the on/off model: no
// always-on endpoints — a client's GPU only exists while THEY have it ON (from
// Billing). Deletes all Novita endpoints in livehost_pool, empties the pool
// table, and clears any gpu_on bindings in live_client_config.
// Run: node scripts/pool-off-all.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
async function novita(path, key, init) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  return await r.json().catch(() => ({}));
}
const { data: settings } = await sb.from("app_settings").select("key,value").eq("key", "novita_api_key");
const clean = (v) => { let s = v; if (typeof s === "string") { try { const p = JSON.parse(s); if (typeof p === "string") s = p; } catch {} s = s.replace(/^"+|"+$/g, ""); } return s; };
const nkey = clean(settings?.[0]?.value);
if (!nkey) { console.error("no novita_api_key"); process.exit(1); }

const { data: rows } = await sb.from("livehost_pool").select("endpoint_id");
for (const r of rows || []) {
  await novita("/endpoint/delete", nkey, { method: "POST", body: JSON.stringify({ id: r.endpoint_id }) });
  console.log("deleted novita endpoint", r.endpoint_id);
}
await sb.from("livehost_pool").delete().neq("endpoint_id", "");
const { data: cleared } = await sb.from("live_client_config")
  .update({ gpu_on: false, gpu_on_at: null, gpu_endpoint_id: null, backend_url: "", updated_at: new Date().toISOString() })
  .eq("gpu_on", true).select("user_id");
console.log("cleared bindings:", (cleared || []).length);
console.log("DONE — all GPU OFF ($0). Clients turn theirs on at Billing.");
