/**
 * Demo asset generator for the landing page.
 * Generates a curated set of UGC-style sample videos + images via Crun.ai (P2),
 * downloads them to /public/demos/, and writes a manifest JSON.
 *
 * Usage:
 *   P2_KEY=ak_xxx node scripts/generate-demos.mjs
 *
 * The landing page reads /public/demos/manifest.json and renders whatever's there.
 * Re-run safely — existing files are skipped.
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
const VIDEO_MODEL = "google/veo3-1-fast-t2v";
const IMAGE_MODEL = "google/nano-banana-pro";

mkdirSync(OUT, { recursive: true });

// ─── Prompts: original UGC scenarios for Malaysian TikTok Shop sellers ─────
const VIDEO_PROMPTS = [
  {
    id: "reel-1",
    label: "Skincare review",
    prompt:
      "Selfie-style handheld vertical 9:16 video, slight camera shake. A young attractive Malay woman in her 20s wearing a soft beige hijab and casual cream blouse, holding a small skincare bottle at chest level, label facing camera. Setting: bedroom vanity in afternoon daylight, soft natural lighting. She speaks directly to camera with warm friendly tone, casual pace. Spoken dialog in Bahasa Melayu Malaysia: 'Eh korang serius kena cuba ni.' Mouth syncs naturally with each word, teeth visible. Authentic amateur iPhone UGC look, natural skin texture with visible pores, no-makeup-makeup, ordinary mixed lighting, lived-in background. Audio: ONE single voice only, clean dialog, NO background music, NO subtitles, NO text overlays, clean vertical frame. RAW unedited footage aesthetic.",
  },
  {
    id: "reel-2",
    label: "Kitchen cooking",
    prompt:
      "Selfie-style vertical 9:16, handheld. An attractive Malay woman in her 30s in casual home outfit cooking at a stove, holding a sauce bottle near a wok of stir-fried noodles. She glances at camera with a slight smile and says in Bahasa Melayu Malaysia: 'Sambal ni memang lain dari yang lain.' Warm kitchen lighting, steam rising from wok, slightly cluttered counter. Natural Malaysian accent, casual conversational tone. Authentic amateur iPhone UGC, real skin texture, no airbrushing. Audio: ONE single voice only, faint kitchen ambience, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-3",
    label: "Gym supplement",
    prompt:
      "Vertical 9:16 selfie, handheld arm's length. Attractive Malay man in his 20s wearing dark sports tee, sweat on forehead, sitting on a gym bench with a protein/supplement bottle on his lap. He breathes lightly and speaks directly to camera in Bahasa Melayu Malaysia with confident casual tone: 'Aku try dah dua minggu, tenaga memang tahan.' Background: gym equipment in soft bokeh, late afternoon natural light through windows. Authentic UGC look, real skin texture with subtle T-zone shine, no glam. Audio: ONE single voice only, faint gym ambience, NO background music, NO subtitles, clean frame.",
  },
  {
    id: "reel-4",
    label: "Driving CTA",
    prompt:
      "Vertical 9:16, dashcam-style angle. A Malay woman in her 20s wearing a dusty pink hijab, sitting in driver seat of a parked car holding a small product bottle. Daylight through windshield, steering wheel in soft bokeh. She speaks playfully, slight smirk, looks at camera then product, in Bahasa Melayu Malaysia: 'Aku simpan dalam kereta je, senang gila!' Authentic iPhone UGC handheld, natural skin, casual outfit. Audio: ONE single voice only, faint car AC hum, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-5",
    label: "Bedroom unbox",
    prompt:
      "Vertical 9:16 handheld. Attractive Malay woman in her 30s in cozy home outfit sitting on bed unboxing a small parcel containing a skincare or supplement product. Soft warm lamp lighting, pillows behind. Excited smile, holds product up close to camera, says in Bahasa Melayu Malaysia: 'Akhirnya sampai! Korang dah cuba ni belum?' Natural Malaysian accent, real skin texture, no makeup. Audio: ONE single voice only, faint room ambience, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-6",
    label: "Office desk",
    prompt:
      "Vertical 9:16 selfie handheld. A Malay woman in her 20s wearing modest navy office blouse and matching hijab, sitting at a tidy office desk with a small product (vitamin or skincare bottle) in front. Window daylight, laptop in soft bokeh. Slight smile, speaks directly to camera in Bahasa Melayu Malaysia with calm professional tone: 'Tengah busy meeting? Ni lifesaver aku.' Authentic UGC iPhone look, real skin texture. Audio: ONE single voice only, faint office ambience, NO music, NO subtitles, clean frame.",
  },
];

const IMAGE_PROMPTS = [
  {
    id: "avatar-hijab-young",
    label: "Hijab young",
    prompt:
      "Photorealistic studio portrait of an attractive Malay woman in her 20s wearing a soft beige hijab and modest cream blouse, holding a small unbranded skincare bottle at chest level. Soft natural lighting, neutral backdrop, friendly genuine smile, real skin texture with visible pores, no airbrushing. Vertical 9:16 composition. Authentic UGC creator look.",
  },
  {
    id: "avatar-hijab-mature",
    label: "Hijab mature",
    prompt:
      "Photorealistic studio portrait of an attractive Malay woman in her 30s wearing a maroon hijab and matching modest blouse, smiling warmly while holding a small unbranded supplement bottle. Soft window lighting, neutral background. Real skin texture, no glam makeup. Vertical 9:16, authentic UGC creator vibe.",
  },
  {
    id: "avatar-male-young",
    label: "Male young",
    prompt:
      "Photorealistic studio portrait of an attractive Malay man in his 20s wearing a casual dark navy tee, short neat hair, holding an unbranded protein bottle. Confident genuine smile, soft daylight, neutral background. Real skin texture with subtle T-zone shine, no airbrushing. Vertical 9:16, authentic UGC creator vibe.",
  },
  {
    id: "avatar-no-hijab",
    label: "No-hijab",
    prompt:
      "Photorealistic studio portrait of an attractive Malay woman in her 20s with shoulder-length wavy hair, wearing a casual pastel pink top, holding an unbranded skincare bottle. Soft daylight, neutral backdrop, warm natural smile. Real skin texture, no-makeup-makeup look. Vertical 9:16, authentic UGC creator vibe.",
  },
];

// ─── P2 client ──────────────────────────────────────────────────────────────
async function p2Create({ model, prompt, durationMode }) {
  const body = {
    model,
    input: {
      prompt,
      aspect_ratio: "9:16",
      ...(durationMode ? { duration: Number(durationMode) } : { resolution: "2K" }),
    },
  };
  const r = await fetch(`${P2_BASE}/api/v1/client/job/CreateTask`, {
    method: "POST",
    headers: {
      "x-api-key": P2_KEY,
      "Content-Type": "application/json",
    },
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

async function p2Poll(taskId, maxMs = 360000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5000));
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
        result?.video_url ||
        result?.image_url ||
        result?.url ||
        (Array.isArray(result?.urls) ? result.urls[0] : null);
      if (!url) throw new Error(`No URL in result: ${JSON.stringify(result).substring(0, 200)}`);
      return url;
    }
    if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) {
      throw new Error(`P2 task failed: ${JSON.stringify(json?.data || json).substring(0, 300)}`);
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

// ─── Run all in parallel ────────────────────────────────────────────────────
async function generateOne({ id, label, prompt, kind }) {
  const ext = kind === "video" ? "mp4" : "png";
  const dest = join(OUT, `${id}.${ext}`);
  if (existsSync(dest)) {
    console.log(`  ${id}: skipped (exists)`);
    return { id, label, file: `/demos/${id}.${ext}`, kind };
  }
  const model = kind === "video" ? VIDEO_MODEL : IMAGE_MODEL;
  console.log(`→ ${id} [${kind}] submitting…`);
  const taskId = await p2Create({
    model,
    prompt,
    durationMode: kind === "video" ? "8" : undefined,
  });
  console.log(`  ${id}: task_id ${taskId}`);
  const url = await p2Poll(taskId);
  console.log(`  ${id}: downloading ${url.substring(0, 60)}…`);
  await downloadTo(url, dest);
  console.log(`✓ ${id}: saved`);
  return { id, label, file: `/demos/${id}.${ext}`, kind };
}

async function main() {
  const tasks = [
    ...VIDEO_PROMPTS.map((p) => ({ ...p, kind: "video" })),
    ...IMAGE_PROMPTS.map((p) => ({ ...p, kind: "image" })),
  ];
  console.log(`Generating ${tasks.length} demo assets to ${OUT}\n`);

  // Batch in groups of 2 with 3s gap between submits (Crun.ai's Cloudflare
  // gateway returns 522 when hammered with 10+ parallel POSTs).
  const ok = [];
  const failed = [];
  const BATCH = 2;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(generateOne));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") ok.push(r.value);
      else failed.push({ id: batch[j].id, error: r.reason?.message });
    });
    // Persist progressive manifest so the page picks up each finished asset
    writeFileSync(
      join(OUT, "manifest.json"),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          videos: ok.filter((r) => r.kind === "video"),
          images: ok.filter((r) => r.kind === "image"),
          failed,
        },
        null,
        2
      )
    );
    if (i + BATCH < tasks.length) await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(
    `\nManifest: ${ok.filter((r) => r.kind === "video").length} videos · ${ok.filter((r) => r.kind === "image").length} images · ${failed.length} failed`
  );
  if (failed.length) console.log("Failed:", failed);
}

main().catch((e) => {
  console.error("Fatal:", e?.message);
  process.exit(1);
});
