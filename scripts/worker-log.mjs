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
const { data: pool } = await sb.from("livehost_pool").select("endpoint_id,status,assigned_user_id,last_seen").order("updated_at", { ascending: false });
const busy = (pool || []).filter((p) => p.status === "busy");
console.log("busy slots:", busy.map((b) => b.endpoint_id).join(", ") || "(none)");
const target = busy[0]?.endpoint_id || (pool || [])[0]?.endpoint_id;
if (!target) { console.log("no endpoint"); process.exit(0); }
const r = await fetch(`https://api.novita.ai/gpu-instance/openapi/v1/endpoint?id=${target}`, { headers: { Authorization: `Bearer ${nkey}` } });
const d = await r.json();
const w = d?.endpoint?.workers?.[0];
console.log("endpoint", target, "workers:", (d?.endpoint?.workers || []).length, "status:", w?.status);
console.log("worker keys:", w ? Object.keys(w).join(",") : "(no worker)");
const log = w?.log || w?.logs || "";
console.log("log length:", log.length);
console.log("---- raw worker log (tail 60 lines) ----");
console.log(log.split("\n").slice(-60).join("\n"));
