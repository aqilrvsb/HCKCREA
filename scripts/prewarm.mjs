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
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const args = process.argv.slice(2);

async function list() {
  const d = await (await fetch(`${BASE}/image/prewarm`, { headers: { Authorization: `Bearer ${nkey}` } })).json();
  return d;
}
console.log("=== current prewarms ===");
console.log(JSON.stringify(await list(), null, 2));

if (args[0] === "create") {
  const body = { imageUrl: "docker.io/aqilrvsb/lh-avtr1:s9-smooth1", imageName: "lh-avtr1-smooth1", clusterId: "as-sgp-2", authId: "73068571-9b1d-44c6-a4d7-fb942614b1a4" };
  const r = await fetch(`${BASE}/image/prewarm`, { method: "POST", headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  console.log("\n=== create prewarm :s9-smooth1 ===", r.status, await r.text());
  console.log("\n=== after ===");
  console.log(JSON.stringify(await list(), null, 2));
}
