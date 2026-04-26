// Upload /public/demos/*.{mp4,png} to Supabase Storage and rewrite
// /public/demos/manifest.json with public CDN URLs.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/upload-demos-to-supabase.mjs

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, extname, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEMOS = join(ROOT, "public", "demos");
const BUCKET = "demos";

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Ensure bucket exists + public
const { data: buckets } = await sb.storage.listBuckets();
if (!buckets?.some((b) => b.name === BUCKET)) {
  console.log(`Creating public bucket ${BUCKET}…`);
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  if (error) { console.error(error); process.exit(1); }
} else {
  // Make sure it's public
  await sb.storage.updateBucket(BUCKET, { public: true });
}

const manifestPath = join(DEMOS, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const files = readdirSync(DEMOS).filter((f) => /\.(mp4|png|jpg|jpeg|webp)$/i.test(f));
console.log(`Uploading ${files.length} files…\n`);

const urlByFile = {};
for (const name of files) {
  const data = readFileSync(join(DEMOS, name));
  const contentType = name.endsWith(".mp4") ? "video/mp4" : "image/png";
  const key = name; // flat path inside bucket
  process.stdout.write(`  ${name} (${(data.length / 1024).toFixed(0)} KB)… `);
  const { error } = await sb.storage.from(BUCKET).upload(key, data, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.log("✗", error.message);
    continue;
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(key);
  urlByFile[name] = pub.publicUrl;
  console.log("✓");
}

// Rewrite manifest paths to public URLs
function rewrite(row) {
  const localFile = row.file?.split("/").pop();
  if (localFile && urlByFile[localFile]) {
    return { ...row, file: urlByFile[localFile] };
  }
  return row;
}

const updated = {
  ...manifest,
  videos: (manifest.videos || []).map(rewrite),
  images: (manifest.images || []).map(rewrite),
};

writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
console.log(`\nManifest rewritten with public URLs.`);
console.log(`Bucket: ${URL}/storage/v1/object/public/${BUCKET}/`);
