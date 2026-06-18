import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let s=v; if(typeof s==="string"){ try{const p=JSON.parse(s); if(typeof p==="string")s=p;}catch{} s=s.replace(/^"+|"+$/g,""); } return s; };
const nkey = clean((await sb.from("app_settings").select("value").eq("key","novita_api_key").single()).data.value);
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const TAG = "s12-watchdog";
const deadline = Date.now() + 40*60*1000;
while (Date.now() < deadline) {
  const d = await (await fetch(`${BASE}/image/prewarm`, { headers:{ Authorization:`Bearer ${nkey}` } })).json();
  const arr = d?.prewarms || d?.data || (Array.isArray(d)?d:[]);
  const row = arr.find(p => (p.imageUrl||"").includes(TAG));
  const st = row?.state || "MISSING";
  const ts = new Date().toISOString().slice(11,19);
  console.log(`${ts} s12 prewarm: ${st}`);
  if (st === "Succeeded") { console.log("PREWARM_DONE"); process.exit(0); }
  if (st === "Failed") { console.log("PREWARM_FAILED"); process.exit(1); }
  await new Promise(r => setTimeout(r, 90000));
}
console.log("PREWARM_TIMEOUT_40MIN"); process.exit(2);
