// One-time migration runner for 0035_p4_grsai_settings.sql.
// Reads .env.local, upserts p4 + image_provider + storytelling/viral
// provider rows into public.app_settings. Idempotent — safe to re-run.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(here, "..", ".env.local");
  const txt = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const rows = [
  {
    key: "p4_key",
    value: { key: "sk-e52290fab6da4d6cbdb4b2e6f26a6fde" },
    description: "Grsai API key. Used by lib/p4.ts (image provider).",
    category: "provider",
  },
  {
    key: "p4_image_default",
    value: { model: "nano-banana-pro" },
    description: "Default model for p4 when image-cascade has no explicit primary model.",
    category: "provider",
  },
  {
    key: "image_provider",
    value: { provider: "p4" },
    description: "Primary provider for the Image tab. p2 (Crun), p3 (Mountsea), or p4 (Grsai).",
    category: "provider",
  },
  {
    key: "viral_provider",
    value: { provider: "p4" },
    description: "Primary provider for Viral Talking Object image step. p2 / p3 / p4.",
    category: "provider",
  },
  {
    key: "storytelling_provider",
    value: { provider: "p4" },
    description: "Primary provider for Storytelling scene images. p2 / p3 / p4.",
    category: "provider",
  },
  {
    key: "fairytale_image_model",
    value: { model: "nano-banana-fast" },
    description: "Image gen model used for Storytelling scene images. Defaults to nano-banana-fast (p4 exclusive).",
    category: "fairytale",
  },
  {
    key: "viral_image_model",
    value: { model: "nano-banana-pro" },
    description: "Image gen model for Viral Talking Object start-frame. Defaults to nano-banana-pro.",
    category: "provider",
  },
];

for (const row of rows) {
  const { error } = await sb
    .from("app_settings")
    .upsert(row, { onConflict: "key" });
  if (error) {
    console.error(`FAIL ${row.key}:`, error.message);
    process.exitCode = 1;
  } else {
    console.log(`OK   ${row.key}`);
  }
}
console.log("Done.");
