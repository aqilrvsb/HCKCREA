// Find all history rows linked to a parent talking-object run via metadata.parent_video_history_id.
// Usage: node scripts/find-children.mjs <parent_id>

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

const parentId = process.argv[2];
if (!parentId) { console.error("Usage: node scripts/find-children.mjs <parent_id>"); process.exit(1); }

// Find any row whose metadata.parent_video_history_id matches
const { data, error } = await sb
  .from("history")
  .select("id, type, tab, status, task_id, error_message, cost, output_url, metadata, created_at, updated_at")
  .order("created_at", { ascending: false })
  .limit(20);

if (error) { console.error(error.message); process.exit(1); }

const children = (data || []).filter(r => r.metadata?.parent_video_history_id === parentId);
console.log(`Found ${children.length} children of ${parentId}:`);
for (const c of children) {
  console.log(JSON.stringify({
    id: c.id,
    type: c.type,
    status: c.status,
    task_id: c.task_id,
    error_message: c.error_message,
    provider: c.metadata?.provider,
    model: c.metadata?.model,
    tier_log: c.metadata?.tier_log,
    stage: c.metadata?.stage,
  }, null, 2));
}
