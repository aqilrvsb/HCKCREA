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

async function listIds() {
  const d = await (await fetch(`${BASE}/endpoints`, { headers: { Authorization: `Bearer ${nkey}` } })).json();
  return (d?.endpoints || []).map((e) => ({ id: e.id || e.endpointId, name: e.name, img: (e.image?.image || "").split("/").pop() }));
}

let all = await listIds();
// only delete lh-pool/lh-avtr1 endpoints NOT in the keep set (never touch other projects)
const toDel = all.filter((e) => !keep.has(e.id) && /lh-pool|lh-avtr1|probe/.test((e.name || "") + (e.img || "")));
console.log("KEEP:", [...keep].join(", "));
console.log("DELETE:", toDel.map((e) => `${e.id}(${e.img})`).join(", ") || "(none)");

for (let pass = 1; pass <= 3 && toDel.length; pass++) {
  console.log(`\n=== delete pass ${pass} ===`);
  for (const e of toDel) {
    const r = await fetch(`${BASE}/endpoint/delete`, { method: "POST", headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id }) });
    const txt = await r.text();
    console.log(`del ${e.id}: HTTP ${r.status} ${txt.slice(0, 120)}`);
    await new Promise((x) => setTimeout(x, 1500));
  }
  await new Promise((x) => setTimeout(x, 4000));
  all = await listIds();
  const remain = all.filter((e) => !keep.has(e.id) && /lh-pool|lh-avtr1|probe/.test((e.name || "") + (e.img || "")));
  console.log(`remaining orphans after pass ${pass}: ${remain.length} [${remain.map((e) => e.id).join(" ")}]`);
  if (!remain.length) break;
  toDel.length = 0; toDel.push(...remain);
}
console.log("\n--- FINAL endpoint list ---");
for (const e of await listIds()) console.log(`${keep.has(e.id) ? "KEEP" : "EXTRA"}\t${e.id}\t${e.img}`);
