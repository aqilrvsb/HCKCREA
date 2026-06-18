// TEST: can we edit minNum on an existing Novita serverless endpoint?
// If yes → "toggle minNum 0<->1" is the proper on/off (no delete, no cluster idle).
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

// pick an existing endpoint
const list = await nv("/endpoints");
const eps = list.body?.endpoints || list.body?.data || [];
if (!eps.length) { console.log("no endpoints to test — create one first"); process.exit(1); }
const id = eps[0].id || eps[0].endpoint?.id;
console.log("testing endpoint:", id);

// GET full config
const g = await nv(`/endpoint?id=${id}`);
const ep = g.body?.endpoint || g.body;
const wc = ep.workerConfig || {};
console.log("current minNum:", wc.minNum);

// Try UPDATE minNum -> flip it
const target = Number(wc.minNum) === 1 ? 0 : 1;
const newEp = { ...ep, workerConfig: { ...wc, minNum: target } };
for (const path of ["/endpoint/update", "/endpoint"]) {
  for (const wrap of [{ endpoint: newEp }, newEp, { id, workerConfig: { ...wc, minNum: target } }, { endpoint: { id, workerConfig: { ...wc, minNum: target } } }]) {
    const u = await nv(path, { method: "POST", body: JSON.stringify(wrap) });
    console.log(`POST ${path} (${Object.keys(wrap).join(",")}) -> ${u.status} ${JSON.stringify(u.body).slice(0, 160)}`);
    if (u.status === 200) {
      await new Promise((r) => setTimeout(r, 2000));
      const v = await nv(`/endpoint?id=${id}`);
      console.log("  -> minNum now:", (v.body?.endpoint || v.body)?.workerConfig?.minNum, "(wanted", target + ")");
      process.exit(0);
    }
  }
}
console.log("UPDATE not accepted in any form — minNum edit NOT supported.");
