// Inspect a single history row by id. Used to verify p4 routing end-to-end.
// Usage: node scripts/inspect-row.mjs <history_id>

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const txt = readFileSync(resolve(here, "..", ".env.local"), "utf-8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/inspect-row.mjs <history_id>");
  process.exit(1);
}

const { data, error } = await sb
  .from("history")
  .select("id, type, tab, status, task_id, error_message, cost, output_url, metadata, created_at, updated_at")
  .eq("id", id)
  .maybeSingle();

if (error) {
  console.error("DB error:", error.message);
  process.exit(1);
}
if (!data) {
  console.log(`No row found for id=${id}`);
  process.exit(0);
}

console.log(JSON.stringify(data, null, 2));
