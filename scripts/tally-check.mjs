// Set meow's endpoint to the OFF config (minNum:0, freeTimeout:1), then report
// ACTIVE worker count (Novita) so we can compare to Usage(MATI)+studio(off).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const MEOW = "5c102586-f32b-4151-abb7-65b953788bce";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clean = (v) => { let x = v; if (typeof x === "string") { try { const p = JSON.parse(x); if (typeof p === "string") x = p; } catch {} x = x.replace(/^"+|"+$/g, ""); } return x; };
const gg = (rows, k) => { const v = clean(rows.find((r) => r.key === k)?.value); return v && typeof v === "object" ? (v.key || "") : (v || ""); };
const { data: rows } = await sb.from("app_settings").select("key,value").in("key", ["novita_api_key", "livehost_turn_key_id", "livehost_turn_key_token", "livehost_minimax_key", "or_key", "livehost_hf_token", "livehost_box_secret"]);
const nkey = String(gg(rows, "novita_api_key"));
const hf = String(gg(rows, "livehost_hf_token"));
const BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const IMAGE = "docker.io/aqilrvsb/lh-avtr1:s12-watchdog", AUTH_ID = "73068571-9b1d-44c6-a4d7-fb942614b1a4", CLUSTER = "as-sgp-2";
const nv = async (path, init) => { const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${nkey}`, "Content-Type": "application/json", ...(init?.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const envs = [
  { key: "CLOUDFLARE_TURN_KEY_ID", value: String(gg(rows, "livehost_turn_key_id")) },
  { key: "CLOUDFLARE_TURN_KEY_TOKEN", value: String(gg(rows, "livehost_turn_key_token")) },
  { key: "MINIMAX_API_KEY", value: String(gg(rows, "livehost_minimax_key")) },
  { key: "OPENROUTER_API_KEY", value: String(gg(rows, "or_key")) },
  { key: "OPENROUTER_MODEL", value: "openai/gpt-4.1" },
  { key: "NOVITA_API_KEY", value: nkey },
  { key: "HF_TOKEN", value: hf }, { key: "HUGGING_FACE_HUB_TOKEN", value: hf },
  { key: "LIVEHOST_CONFIG_URL", value: "https://peninglab.com/api/livehost/engine-config" },
  { key: "LIVEHOST_BOX_SECRET", value: String(gg(rows, "livehost_box_secret")) },
  { key: "NVIDIA_DRIVER_CAPABILITIES", value: "all" }, { key: "FORCE_NVENC", value: "0" }, { key: "RIFE_FPS50", value: "1" }, { key: "RENDERER_HEALTH_MAX_FAIL", value: "999999" },
];
const { data: cfg } = await sb.from("live_client_config").select("gpu_on, gpu_endpoint_id").eq("user_id", MEOW).maybeSingle();
const id = cfg?.gpu_endpoint_id;
console.log("meow gpu_on(DB):", cfg?.gpu_on, "endpoint:", id);
const g = await nv(`/endpoint?id=${id}`);
const ep = g.body?.endpoint || g.body;
// apply OFF config: minNum:0, freeTimeout:1
const body = { id, name: ep.name, clusterID: CLUSTER, workerConfig: { minNum: 0, maxNum: 1, freeTimeout: 1, maxConcurrent: 1, gpuNum: 1, requestTimeout: 120 }, ports: [{ port: "8000" }], policy: { type: "queue", value: 4 }, image: { image: IMAGE, authId: AUTH_ID, command: "" }, envs, healthy: { path: "/ping" } };
const u = await nv("/endpoint/update", { method: "POST", body: JSON.stringify(body) });
console.log("set OFF config (min0, freeTimeout1) ->", u.status);
await new Promise((r) => setTimeout(r, 3000));
const v = await nv(`/endpoint?id=${id}`);
const ep2 = v.body?.endpoint || v.body;
const workers = ep2.workers || [];
const active = workers.filter((w) => { const st = (typeof w.state === "object" ? w.state?.state : w.state) || ""; return !/removed|deleted|failed/i.test(st); });
console.log("freeTimeout now:", ep2.workerConfig?.freeTimeout, "| minNum:", ep2.workerConfig?.minNum);
console.log("ACTIVE workers:", active.length, active.map((w) => (typeof w.state === "object" ? w.state?.state : w.state)).join(","));
console.log("\nTALLY (OFF): Novita active workers =", active.length, "| Usage = MATI | studio = off  =>", active.length === 0 ? "ALL TALLY ✅" : "mismatch — worker still up");
