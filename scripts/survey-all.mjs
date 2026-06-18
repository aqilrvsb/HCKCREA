// Survey: all Novita endpoints, all appointed clients, and prewarm status.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let x = v; if (typeof x === "string") { try { const p = JSON.parse(x); if (typeof p === "string") x = p; } catch {} x = x.replace(/^"+|"+$/g, ""); } return x; };
const { data: s } = await sb.from("app_settings").select("value").eq("key", "novita_api_key").single();
const key = clean(s?.value);
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const nv = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${key}` } }); return r.json().catch(() => ({})); };

// 1. all endpoints
const list = await nv("/endpoints");
const eps = list?.endpoints || list?.data || [];
console.log(`\n=== NOVITA ENDPOINTS (${eps.length}) ===`);
for (const e of eps) {
  const st = typeof e.status === "object" ? e.status?.state : e.status;
  console.log(`  ${e.id}  min=${e.workerConfig?.minNum} max=${e.workerConfig?.maxNum}  ${e.name}  [${st || "-"}]`);
}

// 2. all appointed/bound clients
const { data: cls } = await sb.from("live_client_config")
  .select("user_id, gpu_allowed, gpu_on, gpu_endpoint_id")
  .or("gpu_allowed.eq.true,gpu_endpoint_id.not.is.null");
console.log(`\n=== CLIENTS (allowed or bound) (${cls?.length || 0}) ===`);
for (const c of cls || []) {
  console.log(`  ${c.user_id.slice(0, 8)}  allowed=${c.gpu_allowed} on=${c.gpu_on}  ep=${c.gpu_endpoint_id || "(none)"}`);
}

// 3. reconcile view
const epIds = new Set(eps.map((e) => e.id));
const boundIds = new Set((cls || []).map((c) => c.gpu_endpoint_id).filter(Boolean));
console.log(`\n=== RECONCILE ===`);
const orphans = eps.filter((e) => !boundIds.has(e.id));
console.log(`  orphan endpoints (no client):`, orphans.map((e) => e.id).join(", ") || "none");
const dangling = (cls || []).filter((c) => c.gpu_endpoint_id && !epIds.has(c.gpu_endpoint_id));
console.log(`  clients pointing to a DELETED endpoint:`, dangling.map((c) => c.user_id.slice(0, 8)).join(", ") || "none");

// 4. prewarm
const pw = await nv("/image/prewarm");
const arr = pw?.images || pw?.data || (Array.isArray(pw) ? pw : []);
console.log(`\n=== PREWARM ===`);
if (!arr.length) console.log("  (none / unknown shape)", JSON.stringify(pw).slice(0, 200));
for (const i of arr) console.log(`  ${i.image || i.name}  clusters=${JSON.stringify(i.clusterIDs || i.clusters || i.cluster)}  id=${i.id || "-"}`);
