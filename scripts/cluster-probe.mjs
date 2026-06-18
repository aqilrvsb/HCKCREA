// Find active Novita serverless clusters + retry creating meow's GPU.
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
const g = (rows, k) => { const v = clean(rows.find((r) => r.key === k)?.value); return v && typeof v === "object" ? (v.key || "") : (v || ""); };
const { data: rows } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_turn_key_id", "livehost_turn_key_token", "livehost_minimax_key", "or_key", "livehost_hf_token", "livehost_box_secret"]);
const nkey = String(g(rows, "novita_api_key"));
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const nv = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

console.log("--- cluster/product probes ---");
for (const p of ["/clusters", "/cluster", "/serverless/clusters", "/products", "/product"]) {
  const r = await nv(p);
  console.log(`GET ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
}
