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
const H = { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json" };
const cnt = async () => (await (await fetch(`${BASE}/image/prewarm`, { headers: H })).json())?.total;
const TARGET = "vbeyamybt9f1oxne"; // :s8 (oldest, safe stale)
console.log("before total:", await cnt());
const tries = [
  ["POST", `/image/prewarm/delete`, JSON.stringify({ id: TARGET })],
  ["DELETE", `/image/prewarm?id=${TARGET}`, null],
  ["DELETE", `/image/prewarm/${TARGET}`, null],
  ["POST", `/image/prewarm/cancel`, JSON.stringify({ id: TARGET })],
];
for (const [method, path, body] of tries) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body });
    console.log(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 100)}`);
  } catch (e) { console.log(`${method} ${path} -> ERR ${e.message}`); }
  await new Promise((x) => setTimeout(x, 800));
}
console.log("after total:", await cnt());
