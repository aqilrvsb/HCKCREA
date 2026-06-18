// Inspect the endpoint's live workers + the valid freeTimeout range.
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
const nv = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${key}` } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const ID = "e4f839e5dfeb014e";

const g = await nv(`/endpoint?id=${ID}`);
const ep = g.body?.endpoint || g.body;
console.log("=== ENDPOINT", ID, "===");
console.log("minNum:", ep.workerConfig?.minNum, "maxNum:", ep.workerConfig?.maxNum, "freeTimeout:", ep.workerConfig?.freeTimeout);
console.log("status:", JSON.stringify(ep.status));
console.log("workers:", JSON.stringify(ep.workers || ep.worker || "(none in detail)").slice(0, 400));

// worker list endpoints (probe a few shapes)
for (const p of [`/endpoint/workers?id=${ID}`, `/workers?endpointId=${ID}`, `/endpoint/worker?id=${ID}`]) {
  const r = await nv(p);
  console.log(`GET ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}

// parameter limit ranges (find min freeTimeout)
for (const p of ["/endpoint/parameter-limit", "/endpoint/parameter-limits", "/endpoint/limit", "/endpoint/limits"]) {
  const r = await nv(p);
  if (r.status === 200) { console.log(`\n=== LIMITS ${p} ===\n`, JSON.stringify(r.body).slice(0, 600)); break; }
  else console.log(`GET ${p} -> ${r.status}`);
}
