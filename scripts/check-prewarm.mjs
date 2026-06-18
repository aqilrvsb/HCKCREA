// Check Novita image-prewarm status + the new endpoint's boot state.
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
const nv = async (path) => { const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${key}` } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

console.log("--- prewarm API probes ---");
for (const p of ["/image/prewarm", "/prewarm", "/image/prewarms", "/cache/image", "/image/cache"]) {
  const r = await nv(p);
  console.log(`GET ${p} -> http ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}
console.log("\n--- endpoint aa097f9c349c7863 boot state ---");
const d = await nv("/endpoint?id=aa097f9c349c7863");
const ep = d.body?.endpoint || d.body;
console.log("endpoint state:", JSON.stringify(ep?.status?.state || ep?.state));
for (const w of ep?.workers || []) console.log("  worker", w.id, "state=", JSON.stringify(w.state), "created=", w.createdAt, "ready=", w.readyAt);
