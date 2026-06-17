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
const keep = new Set(((await sb.from("livehost_pool").select("endpoint_id")).data || []).map((r) => r.endpoint_id));
console.log("KEEP (current pool):", [...keep].join(", "));

// try a few list shapes
let list = null;
for (const path of ["/endpoints", "/endpoint/list", "/endpoint"]) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${nkey}` } });
  const d = await r.json().catch(() => ({}));
  const arr = d?.endpoints || d?.data || d?.list || (Array.isArray(d) ? d : null);
  if (Array.isArray(arr)) { list = arr; console.log(`(listed via ${path}: ${arr.length})`); break; }
  console.log(`${path} ->`, JSON.stringify(d).slice(0, 160));
}
if (!list) { console.log("could not list endpoints"); process.exit(0); }
console.log("\n--- ALL ENDPOINTS ---");
for (const e of list) {
  const id = e.id || e.endpointId;
  const img = (e.image?.image || e.imageUrl || "").split("/").pop();
  const mark = keep.has(id) ? "KEEP" : (/lh-avtr1|lh-pool|probe/.test((e.name || "") + img) ? "DELETE?" : "OTHER");
  console.log(`${mark}\t${id}\t${e.name || ""}\t${img}\t status=${e.status || e.state || "?"}`);
}
