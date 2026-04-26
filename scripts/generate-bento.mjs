/**
 * Generate emotional bento card visuals via Crun.ai (GPT Image 2 / nano-banana-pro).
 * Each visual amplifies fear / emotion / urgency for the matching feature card.
 *
 * Usage:  P2_KEY=ak_xxx node scripts/generate-bento.mjs
 *
 * Saves to /public/demos/bento-*.png so the existing Supabase upload script
 * picks them up on next run.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "demos");

const P2_KEY = process.env.P2_KEY;
if (!P2_KEY) {
  console.error("Set P2_KEY env var.");
  process.exit(1);
}

const P2_BASE = "https://api.crun.ai";
const IMAGE_MODEL = "google/nano-banana-pro";

mkdirSync(OUT, { recursive: true });

// 4 emotional bento card visuals — each card lands on a different lever:
// abundance (overwhelm flipped to power), social proof (notifications), strategic
// advantage (clone), passive sales (autopost while you sleep).
const BENTO_PROMPTS = [
  {
    id: "bento-auto-content",
    prompt:
      "Photoreal cinematic 3D product render. Ten iPhones arranged in a clean fan formation against a deep dark background, each phone screen glowing softly with vertical TikTok-style content. The center phone is brightest with warm orange rim light, the outer phones fade gradually into dramatic shadow. Premium luxury commercial aesthetic, sharp focus, shallow depth of field. Color palette: deep charcoal background with vivid orange and amber highlights. Sense of abundance and creative power. NO text, NO logos, NO watermarks. Square 1:1 composition.",
  },
  {
    id: "bento-veo-viral",
    prompt:
      "Photoreal cinematic 3D render. A single iPhone floats in center frame with a vertical 9:16 TikTok video paused on screen showing a young person speaking to camera. Around the phone, floating glass notification bubbles cascade in mid-air showing red heart icons, '+10K', dollar signs, and shopping bag silhouettes — implying viral engagement. Dramatic dark navy background, intense orange-amber rim light, subtle floating particles. Premium luxury commercial aesthetic, sharp focus on phone, soft bokeh on bubbles. NO actual text — only icon shapes and silhouettes. Square 1:1 composition.",
  },
  {
    id: "bento-clone-spy",
    prompt:
      "Photoreal cinematic 3D render. Two identical iPhones placed side by side at a slight angle on a dark glossy reflective surface, both showing vertical TikTok-style video paused. A glowing amber arrow connects the left phone to the right phone, suggesting transformation or replication. The left phone has a subtle viral aura (soft glow), the right phone has a fresh confident aura. Deep dark background, dramatic warm amber backlight, shallow depth of field. Premium luxury aesthetic, sense of strategic advantage. NO text, NO labels. Square 1:1 composition.",
  },
  {
    id: "bento-autopost-sales",
    prompt:
      "Photoreal cinematic 3D render. An iPhone resting screen-up on a dark wooden surface showing a lock screen at night, with dozens of stacked notification cards cascading down the screen — each notification represented by small green pill-shaped bars (no readable text), creating a vertical waterfall of sale alerts. Soft moonlight glow from above, deep navy-black background, subtle emerald green accent light from the phone screen. Premium luxury aesthetic, sense of passive income while sleeping, soft shallow depth of field. NO actual text, only icon and pill shapes. Square 1:1 composition.",
  },
];

async function p2Create({ model, prompt }) {
  const body = {
    model,
    input: { prompt, aspect_ratio: "1:1", resolution: "2K" },
  };
  const r = await fetch(`${P2_BASE}/api/v1/client/job/CreateTask`, {
    method: "POST",
    headers: { "x-api-key": P2_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`Create failed (${r.status}): ${text.substring(0, 300)}`);
  const id = json?.data?.task_id || json?.task_id;
  if (!id) throw new Error(`No task_id: ${text.substring(0, 300)}`);
  return id;
}

async function p2Poll(taskId, maxMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(
      `${P2_BASE}/api/v1/client/job/TaskInfo?task_id=${encodeURIComponent(taskId)}`,
      { headers: { "x-api-key": P2_KEY } }
    );
    const json = await r.json().catch(() => ({}));
    const raw = (json?.data?.status || json?.status || "").toLowerCase();
    if (["success", "succeeded", "completed", "done"].includes(raw)) {
      const result = json?.data?.result || json?.result || {};
      const url =
        (Array.isArray(result?.media_urls) ? result.media_urls[0] : null) ||
        result?.image_url || result?.url ||
        (Array.isArray(result?.urls) ? result.urls[0] : null);
      if (!url) throw new Error(`No URL in result`);
      return url;
    }
    if (["failed", "fail", "error"].includes(raw)) {
      throw new Error(`P2 failed: ${JSON.stringify(json?.data || json).substring(0, 300)}`);
    }
  }
  throw new Error("Poll timeout");
}

async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
}

async function generateOne({ id, prompt }) {
  const dest = join(OUT, `${id}.png`);
  if (existsSync(dest)) {
    console.log(`  ${id}: skipped (exists)`);
    return;
  }
  console.log(`→ ${id} submitting…`);
  const taskId = await p2Create({ model: IMAGE_MODEL, prompt });
  const url = await p2Poll(taskId);
  await downloadTo(url, dest);
  console.log(`✓ ${id}: saved`);
}

async function main() {
  console.log(`Generating ${BENTO_PROMPTS.length} bento visuals to ${OUT}\n`);
  const results = await Promise.allSettled(BENTO_PROMPTS.map(generateOne));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.log(`✗ ${BENTO_PROMPTS[i].id}: ${r.reason?.message}`);
  });
  console.log(`\nDone.`);
}

main().catch((e) => { console.error("Fatal:", e?.message); process.exit(1); });
