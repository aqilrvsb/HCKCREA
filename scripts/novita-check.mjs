// Inspect each Novita endpoint's worker config + live worker count, so we know
// what actually costs money (workers running) vs $0 (no worker / minNum 0).
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

const list = await (await fetch(BASE + "/endpoints", { headers: { Authorization: `Bearer ${key}` } })).json();
const eps = list?.endpoints || list?.data || [];
for (const e of eps) {
  const id = e.id || e.endpoint?.id;
  const d = await (await fetch(`${BASE}/endpoint?id=${id}`, { headers: { Authorization: `Bearer ${key}` } })).json();
  const ep = d?.endpoint || d;
  const wc = ep?.workerConfig || {};
  const workers = ep?.workers || [];
  const live = workers.filter((w) => w.state !== "removed" && w.state !== "deleted").map((w) => w.state);
  console.log(`${id} | ${ep?.name || ""}`);
  console.log(`   minNum=${wc.minNum} maxNum=${wc.maxNum} freeTimeout=${wc.freeTimeout} | endpoint state=${ep?.status?.state || ep?.state}`);
  console.log(`   workers total=${workers.length} live=${live.length} states=[${live.join(",")}]`);
}
