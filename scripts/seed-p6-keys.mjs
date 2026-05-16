// Seed 8 empty p6 key rows so they show up in the admin Provider
// Keys card for the user to paste actual APIPod keys into. Each row
// follows the existing {"key": "..."} JSON pattern.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
readFileSync(resolve(here, "..", ".env.local"), "utf-8").split("\n").forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
for (const ltr of letters) {
  const key = `p6_key_${ltr}`;
  const row = {
    key,
    value: { key: "" },
    description: `APIPod (p6) API key ${ltr.toUpperCase()}. Used by slot p6-${ltr} in the cascade rotation. Paste sk-... key here.`,
    category: "provider",
  };
  const { error } = await sb.from("app_settings").upsert(row, { onConflict: "key" });
  console.log(error ? `FAIL ${key}: ${error.message}` : `OK   ${key}`);
}
console.log("\nDone. Paste keys via /admin/settings → Provider Keys & URLs card.");
