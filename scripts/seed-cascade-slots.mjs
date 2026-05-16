// Seed the new main+fallback cascade slot configuration in app_settings.
// Defaults: 10 main + 10 fallback slots per asset, with the first
// few populated and the rest set to "none" (admin fills in as needed).
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

const VIDEO_MAIN = ["p6-a", "p6-b", "p6-c", "p2-a", "p2-b", "none", "none", "none", "none", "none"];
const VIDEO_FALLBACK = ["p5", "p1", "none", "none", "none", "none", "none", "none", "none", "none"];
const IMAGE_MAIN = ["p4", "p5", "p6-a", "p2-a", "none", "none", "none", "none", "none", "none"];
const IMAGE_FALLBACK = ["p2-b", "p1", "none", "none", "none", "none", "none", "none", "none", "none"];

const rows = [
  { key: "video_main_count", value: { count: 10 }, description: "Number of video main slots (admin-tunable).", category: "provider" },
  { key: "video_fallback_count", value: { count: 10 }, description: "Number of video fallback slots (admin-tunable).", category: "provider" },
  { key: "video_main_slots", value: { slots: VIDEO_MAIN }, description: "Video main slots — round-robin source.", category: "provider" },
  { key: "video_fallback_slots", value: { slots: VIDEO_FALLBACK }, description: "Video fallback slots — tried in order after all mains fail.", category: "provider" },
  { key: "image_main_count", value: { count: 10 }, description: "Number of image main slots (admin-tunable).", category: "provider" },
  { key: "image_fallback_count", value: { count: 10 }, description: "Number of image fallback slots (admin-tunable).", category: "provider" },
  { key: "image_main_slots", value: { slots: IMAGE_MAIN }, description: "Image main slots — round-robin source.", category: "provider" },
  { key: "image_fallback_slots", value: { slots: IMAGE_FALLBACK }, description: "Image fallback slots — tried after all mains fail.", category: "provider" },
];

for (const row of rows) {
  const { error } = await sb.from("app_settings").upsert(row, { onConflict: "key" });
  console.log(error ? `FAIL ${row.key}: ${error.message}` : `OK   ${row.key}`);
}
console.log("\nDone. Cascade now uses main+fallback architecture with 10/10 default slots.");
