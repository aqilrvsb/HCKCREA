// List the real Novita serverless endpoints we have (to populate the admin
// assign dropdown from reality, not just the DB pool table).
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

const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
for (const path of ["/endpoints", "/endpoint/list", "/endpoint"]) {
  try {
    const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${key}` } });
    const d = await r.json().catch(() => ({}));
    const arr = d?.endpoints || d?.data || d?.list || (Array.isArray(d) ? d : null);
    console.log(`\n=== GET ${path} (http ${r.status}) ===`);
    if (Array.isArray(arr)) {
      for (const e of arr) console.log(" -", e.id || e.endpoint?.id, "|", e.name || e.endpoint?.name, "|", e.status || e.state || "");
      console.log("  total:", arr.length);
    } else {
      console.log("  shape:", JSON.stringify(d).slice(0, 400));
    }
  } catch (e) { console.log(path, "ERR", e.message); }
}
