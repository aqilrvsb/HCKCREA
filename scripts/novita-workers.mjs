// Inspect one endpoint's worker history (states + ready/deleted times) to see
// if the worker was dropped/recreated mid-stream. Usage: node scripts/novita-workers.mjs <endpointId>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: s } = await sb.from("app_settings").select("value").eq("key", "novita_api_key").single();
const clean = (v) => { let x = v; if (typeof x === "string") { try { const p = JSON.parse(x); if (typeof p === "string") x = p; } catch {} x = x.replace(/^"+|"+$/g, ""); } return x; };
const key = clean(s?.value);
const id = process.argv[2] || "f7ab46c1b51bc9d9";
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const d = await (await fetch(`${BASE}/endpoint?id=${id}`, { headers: { Authorization: `Bearer ${key}` } })).json();
const ep = d?.endpoint || d;
const wc = ep?.workerConfig || {};
console.log("endpoint", id, "| state:", JSON.stringify(ep?.status?.state || ep?.state));
console.log("workerConfig:", JSON.stringify(wc));
const workers = ep?.workers || [];
console.log("workers:", workers.length);
for (const w of workers) {
  console.log(`  - ${w.id || w.name} | state=${w.state} | createdAt=${w.createdAt || ""} readyAt=${w.readyAt || ""} deletedAt=${w.deletedAt || ""}`);
}
