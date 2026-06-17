import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let s = v; if (typeof s === "string") { try { const p = JSON.parse(s); if (typeof p === "string") s = p; } catch {} s = s.replace(/^"+|"+$/g, ""); } return s; };
const nkey = clean((await sb.from("app_settings").select("value").eq("key", "novita_api_key").single()).data.value);
const { data: pool } = await sb.from("livehost_pool").select("endpoint_id").order("created_at");
const total = async () => {
  let sum = 0; const parts = [];
  for (const p of pool) {
    const d = await (await fetch(`https://api.novita.ai/gpu-instance/openapi/v1/endpoint?id=${p.endpoint_id}`, { headers: { Authorization: `Bearer ${nkey}` } })).json();
    const wc = (d?.endpoint?.workers || []).length; sum += wc; parts.push(`${p.endpoint_id.slice(0,8)}=${wc}`);
  }
  return { sum, parts };
};
for (let i = 0; i < 10; i++) {
  const { sum, parts } = await total();
  console.log(`t=${i * 3}min  totalWorkers=${sum}  [${parts.join(" ")}]`);
  if (sum === 0) { console.log("ALL IDLE ($0) — every pool worker scaled to zero."); break; }
  await new Promise((r) => setTimeout(r, 180000));
}
