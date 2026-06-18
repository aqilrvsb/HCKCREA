// Delete EVERY Novita serverless endpoint + verify empty. Clean slate ($0).
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
const nv = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

for (let pass = 1; pass <= 3; pass++) {
  const { body } = await nv("/endpoints");
  const eps = body?.endpoints || body?.data || [];
  console.log(`pass ${pass}: ${eps.length} endpoints`);
  if (!eps.length) break;
  for (const e of eps) {
    const id = e.id || e.endpoint?.id;
    const d = await nv("/endpoint/delete", { method: "POST", body: JSON.stringify({ id }) });
    console.log(`  delete ${id} -> http ${d.status} ${JSON.stringify(d.body).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
await sb.from("livehost_pool").delete().neq("endpoint_id", "");
const { body: fin } = await nv("/endpoints");
console.log("FINAL endpoints:", (fin?.endpoints || fin?.data || []).length);
