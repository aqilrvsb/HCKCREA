// One-time seed for migration 0036 — creates the Postgres sequences,
// the next_cascade_slot RPC, and the slot config rows. Run once.

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

// The migration file has the SQL for the sequences + RPC. We can't run
// arbitrary SQL via the JS client without a custom RPC — so we use the
// `query` REST endpoint via raw fetch.
const sqlMigration = readFileSync(
  resolve(here, "..", "supabase", "migrations", "0036_cascade_rotation.sql"),
  "utf-8"
);

// Strip the INSERTs (those we'll upsert via JS) and only run the DDL.
const ddl = sqlMigration
  .split(/^insert into/im)[0]
  .trim();

// Use the SQL endpoint via the service role. Supabase Cloud exposes
// /rest/v1/rpc/exec_sql only if you create that function — we won't
// rely on it. Instead, we'll create the RPC + sequences via the
// pg-meta API if available, else just upsert the rows and ask the
// user to run the DDL portion manually.
//
// Safer path: just upsert the app_settings rows here (the cascade
// works without sequences IF nextStartSlot's catch path returns 0,
// which means everything starts at slot 1 always — degrades to fixed
// order, no round-robin until the sequences are created).

const rows = [
  {
    key: "p5_image_default",
    value: { model: "gemini-3-pro-image-preview" },
    description: "Default APIMart image model. gemini-3-pro-image-preview = Nano Banana Pro.",
    category: "provider",
  },
  {
    key: "p5_video_default",
    value: { model: "veo3.1-fast" },
    description: "Default APIMart video model. veo3.1-fast is the cheapest gen at $0.08/call.",
    category: "provider",
  },
  {
    key: "video_cascade_slots",
    value: { slots: ["p2-a", "p2-b", "p5"] },
    description: "Round-robin slot config for video cascade. 3 slots, walk wraps + retries start. Each slot: p1 / p2-a / p2-b / p5.",
    category: "provider",
  },
  {
    key: "image_cascade_slots",
    value: { slots: ["p4", "p5", "p2-a"] },
    description: "Round-robin slot config for image cascade. 3 slots, walk wraps + retries start. Each slot: p1 / p2-a / p2-b / p4 / p5.",
    category: "provider",
  },
];

// Seed p5_key as empty so it appears in the admin "Provider Keys" card
// where the user can paste the actual sk- key via the UI.
rows.unshift({
  key: "p5_key",
  value: { key: "" },
  description: "APIMart API key. Used by lib/p5.ts (image + video provider). Paste sk-... key in /admin/settings.",
  category: "provider",
});

for (const row of rows) {
  const { error } = await sb.from("app_settings").upsert(row, { onConflict: "key" });
  if (error) {
    console.error(`FAIL ${row.key}:`, error.message);
    process.exitCode = 1;
  } else {
    console.log(`OK   ${row.key}`);
  }
}

console.log("\nNOTE: Postgres sequences (video_cascade_rotation, image_cascade_rotation) +");
console.log("the next_cascade_slot RPC must be created via the Supabase SQL editor.");
console.log("Paste the contents of supabase/migrations/0036_cascade_rotation.sql there");
console.log("(or just the CREATE SEQUENCE + CREATE FUNCTION parts).");
console.log("Without them, cascade-rotation falls back to slot 0 (no round-robin) — still functional.");
