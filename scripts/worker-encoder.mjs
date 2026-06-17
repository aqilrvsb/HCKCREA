// Probe the worker log for which H264 encoder opened (NVENC vs libx264).
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
const { data: pool } = await sb.from("livehost_pool").select("endpoint_id,status").order("updated_at", { ascending: false });
const target = (pool || []).find((p) => p.status === "busy")?.endpoint_id || (pool || [])[0]?.endpoint_id;
console.log("endpoint:", target);
const r = await fetch(`https://api.novita.ai/gpu-instance/openapi/v1/endpoint?id=${target}`, { headers: { Authorization: `Bearer ${nkey}` } });
const d = await r.json();
const w = d?.endpoint?.workers?.[0];
console.log("workers:", (d?.endpoint?.workers || []).length, "status:", w?.status);
let log = w?.log || "";
// If log is a URL, fetch its content.
if (/^https?:\/\//.test(log.trim())) {
  const url = log.trim();
  console.log("fetching logtail:", url.slice(0, 80) + "...");
  for (const hdrs of [{ Authorization: `Bearer ${nkey}` }, {}]) {
    try {
      const lr = await fetch(url, { headers: hdrs });
      const txt = await lr.text();
      if (txt && txt.length > 50) { log = txt; break; }
      console.log("  attempt status", lr.status, "len", txt.length);
    } catch (e) { console.log("  fetch err", e.message); }
  }
}
const lines = log.split("\n");
const enc = lines.filter((l) => /nvenc|libx264|H264 encoder|encoder:/i.test(l));
console.log("=== encoder lines ===");
console.log(enc.length ? enc.join("\n") : "(none found; total log lines: " + lines.length + ")");
