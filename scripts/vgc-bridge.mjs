// Upload only PeningLab's bridge (vgc-bridge/peninglab.js + .css) to the private `vgc-vault` bucket — for a bridge
// change without a new vault copy (scripts/vgc-sync.mjs uploads the whole vault + the bridge). The /vgc route keeps
// one assembled page (__bundle.html); it is removed here so the next visit rebuilds it with the new bridge.
//   node scripts/vgc-bridge.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const [name, type] of [["peninglab.js", "text/javascript"], ["peninglab.css", "text/css"]]) {
  const { error } = await sb.storage.from("vgc-vault").upload(name, readFileSync(join(ROOT, "vgc-bridge", name)), { contentType: type, upsert: true });
  console.log(error ? `✗ ${name}: ${error.message}` : `✓ ${name}`);
}
await sb.storage.from("vgc-vault").remove(["__bundle.html"]);
console.log("✓ assembled page cleared (rebuilt on the next visit, ≤5 min per server instance)");
