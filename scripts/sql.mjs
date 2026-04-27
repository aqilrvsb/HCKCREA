// Ad-hoc DB query runner — uses the SERVICE_ROLE key from .env.local to
// reach Supabase via PostgREST. Table-level operations only (select/insert/
// update/delete); for arbitrary SQL (cron, system tables) run in the
// Supabase SQL editor.
//
// Usage:
//   node scripts/sql.mjs select history "user_id=eq.<uuid>&order=created_at.desc&limit=5"
//   node scripts/sql.mjs select profiles "id=eq.<uuid>"
//   node scripts/sql.mjs select history "limit=3"
//
// The 3rd arg is a PostgREST query string — see https://postgrest.org/
//
// Special: `node scripts/sql.mjs ping` checks the connection works.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load .env.local manually (no dotenv dep needed)
const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const sb = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cmd = process.argv[2];

if (!cmd || cmd === "ping") {
  // Sanity check — count rows in profiles
  const { error, count } = await sb
    .from("profiles")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("Ping failed:", error.message);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, profiles_count: count }, null, 2));
  process.exit(0);
}

if (cmd === "select") {
  const table = process.argv[3];
  const filterStr = process.argv[4] || "";
  if (!table) {
    console.error("Usage: node scripts/sql.mjs select <table> [<query>]");
    process.exit(2);
  }
  // Parse PostgREST-like query string (limited subset: filters, order, limit)
  let q = sb.from(table).select("*");
  for (const part of filterStr.split("&")) {
    if (!part) continue;
    const [key, val] = part.split("=");
    if (key === "limit") q = q.limit(Number(val));
    else if (key === "order") {
      const [col, dir] = val.split(".");
      q = q.order(col, { ascending: dir !== "desc" });
    } else if (val) {
      // op format: col=op.value (eq, gte, lt, like, ...)
      const m = val.match(/^([a-z]+)\.(.*)$/);
      if (m) q = q.filter(key, m[1], m[2]);
      else q = q.eq(key, val);
    }
  }
  const { data, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

console.error(`Unknown command '${cmd}'. Try: ping | select <table> [<query>]`);
process.exit(2);
