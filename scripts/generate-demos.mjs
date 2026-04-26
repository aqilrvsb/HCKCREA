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

// ─── 12 distinct UGC styles to showcase Veo 3.1's range for the landing reel.
// Each prompt includes: persona, setting, hook line in BM, product anchor,
// benefit beat, soft CTA. All 8s vertical 9:16. Single voice, no music, no subs.
const VIDEO_PROMPTS = [
  {
    id: "reel-1",
    label: "Bestie · Skincare",
    prompt:
      "Selfie vertical 9:16, handheld iPhone UGC, slight shake. Attractive Malay woman in her 20s wearing soft beige hijab and casual cream blouse, sitting at bedroom vanity in golden hour daylight. She leans close to camera with warm bestie smile, holds a small unbranded serum bottle to the lens label-out, then speaks directly to camera in natural Bahasa Melayu Malaysia: 'Stop scroll dulu—muka aku tukar dalam tiga hari je.' Mouth syncs precisely with every word, teeth visible, slight cheek lift on the smile. Real skin texture with visible pores, no-makeup-makeup, lived-in vanity background with scattered products in soft bokeh. Audio: ONE single female voice, clean conversational delivery, faint room tone, ABSOLUTELY NO background music, NO subtitles, NO text overlays. Raw unedited iPhone footage aesthetic.",
  },
  {
    id: "reel-2",
    label: "Kitchen · Sambal",
    prompt:
      "Vertical 9:16 handheld selfie. Attractive Malay woman in her 30s, casual loose hair, light apron, standing at stove with a wok of glistening stir-fry noodles. She lifts an unbranded sambal jar near the wok, glances at camera with a confident half-smile, dialog in Bahasa Melayu Malaysia: 'Last week kawan aku try sambal ni—dia call balik tanya kat mana beli.' Steam rises around her face, warm kitchen tungsten light, slightly cluttered counter with herbs and a wooden spoon. Mouth lip-sync precise, natural Malaysian intonation. Audio: ONE single voice, soft sizzle from wok, NO music, NO subtitles, clean frame. Authentic iPhone UGC, real skin texture, faint forehead shine.",
  },
  {
    id: "reel-3",
    label: "Gym · Supplement",
    prompt:
      "Vertical 9:16 selfie at arm's length. Attractive Malay man in his late 20s wearing fitted black sports tee, slight sweat on forehead and temples, sitting on a gym bench with a protein shaker and an unbranded supplement bottle in his hand. He breathes once, looks straight at camera with calm confident tone, says in Bahasa Melayu Malaysia: 'Aku pakai supplement ni tiga minggu—tenaga tahan sampai set last.' Late afternoon golden window light streaming across the gym floor, dumbbells and machines in soft bokeh behind. Mouth precise lip-sync. Audio: ONE male voice, faint distant clinking of weights, NO music, NO subtitles, clean frame. Authentic UGC iPhone, real skin with T-zone shine.",
  },
  {
    id: "reel-4",
    label: "In-car · Driving CTA",
    prompt:
      "Vertical 9:16 dashcam-mounted angle. Attractive Malay woman in her 20s wearing a dusty pink hijab, sitting in driver seat of a parked SUV, hands on steering wheel. Bright daylight through windshield, palm trees in soft blur outside. She picks up a small unbranded skincare bottle from passenger seat, holds it up smirking playfully, says in Bahasa Melayu Malaysia: 'Aku simpan dalam kereta je—touch up bila trafik jam, gilaa convenient.' Casual sundress, single gold ring, natural daylight glow on her cheek. Mouth precise lip-sync. Audio: ONE female voice, faint car AC hum, NO music, NO subtitles, clean frame. Authentic iPhone UGC.",
  },
  {
    id: "reel-5",
    label: "Bedroom · Unbox",
    prompt:
      "Vertical 9:16 handheld iPhone UGC. Attractive Malay woman in her early 30s in cozy oversized cream sweater, no hijab, soft wavy shoulder hair, sitting cross-legged on white bed with a small brown parcel. She tears the parcel open with excited gasp, pulls out an unbranded skincare bottle, holds it triumphantly close to the lens, says in Bahasa Melayu Malaysia: 'Akhirnya sampai! Aku tunggu dua minggu untuk benda ni.' Soft bedside lamp warm tungsten glow, white sheets and pillows, plant in corner bokeh. Genuine wide-eye excitement, mouth precise lip-sync. Audio: ONE female voice, faint paper crinkle, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-6",
    label: "Office · Vitamin C",
    prompt:
      "Vertical 9:16 selfie handheld. Attractive Malay woman in her late 20s wearing modest navy blazer over white inner and matching navy hijab, sitting at tidy office desk near a wide window. Soft midday daylight on her face, MacBook and ceramic coffee cup in soft blur behind. She lifts a small unbranded vitamin bottle into frame, calm professional half-smile, says in Bahasa Melayu Malaysia with measured confident pace: 'Aku pakai vitamin ni enam bulan—tak sakit langsung sepanjang musim flu.' Mouth precise lip-sync. Audio: ONE female voice, very faint distant office ambience, NO music, NO subtitles, clean frame. Authentic iPhone UGC.",
  },
  {
    id: "reel-7",
    label: "Cartoon · Anime UGC",
    prompt:
      "Vertical 9:16 anime-style cel-shaded animation, Studio Ghibli meets modern Korean webtoon aesthetic. A cute young Malay anime girl character with soft beige hijab, large expressive brown eyes, light blush on cheeks, sitting in pastel pink anime bedroom with floating sparkles. She holds a stylized cartoon skincare bottle to her cheek, eyes turn to sparkly hearts, dialog in Bahasa Melayu Malaysia with cute upbeat delivery: 'Korang tak percaya—muka aku glow gila lepas pakai ni!' Mouth animated lip-sync precisely with every syllable. Soft anime background music NOT included—just clean voice. Crisp 2D animation, vibrant pastels, cute kawaii energy. Audio: ONE single female voice with bright cute Malaysian accent, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-8",
    label: "Talking Product · 3D",
    prompt:
      "Vertical 9:16 photoreal CGI 3D animation. A small unbranded white skincare serum bottle sits on a marble bathroom counter under soft morning light. The bottle has cute large cartoon eyes and an animated mouth on its label area. The bottle gently bobs side-to-side and speaks directly to camera in cheerful Bahasa Melayu Malaysia, mouth syncing precisely: 'Hai sayang! Aku akan buat muka kau glow dalam tujuh hari—janji!' Soft bathroom bokeh background with tiles and a folded white towel. Realistic Pixar-quality lighting, subsurface scattering on the bottle, clean shadows. Audio: ONE single playful female voice with light Malaysian accent, faint reverb of bathroom, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-9",
    label: "Cafe · Aspirational",
    prompt:
      "Vertical 9:16 cinematic handheld. Attractive Malay woman in her 20s with shoulder-length wavy hair, no hijab, wearing soft cream knit cardigan, sitting at a window seat in a sunlit minimalist cafe. Latte art mug and an unbranded premium serum bottle on the wooden table. Warm golden window light pours across her face creating a soft halo. She takes a slow breath, half-smile, looks directly to camera, dialog in Bahasa Melayu Malaysia with calm confident lifestyle tone: 'Setiap pagi aku mula dengan ni—glow yang real, bukan filter.' Mouth precise lip-sync. Cinematic shallow depth of field, plants and warm wood tones in soft bokeh. Audio: ONE female voice, very faint cafe murmur, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-10",
    label: "Comedy · Reaction",
    prompt:
      "Vertical 9:16 selfie handheld iPhone UGC. Attractive Malay man in his early 30s standing in bathroom in front of mirror, casual home tee, ruffled hair. He stares wide-eyed at his hairline in the mirror, then snaps to camera with exaggerated comedic shock face, holds up an unbranded hair growth oil bottle, says in Bahasa Melayu Malaysia with surprised playful tone: 'Eh apa ni serius?! Dua minggu je rambut dah balik!' Bright bathroom LED light, white tiles. Mouth precise lip-sync, eyebrows raised, slight head jerk back. Audio: ONE single male voice, faint bathroom reverb, NO music, NO subtitles, clean frame. Real skin texture, ordinary man-next-door look.",
  },
  {
    id: "reel-11",
    label: "Confession · Story",
    prompt:
      "Vertical 9:16 handheld iPhone UGC. Attractive Malay woman in her late 20s wearing soft maroon hijab and oversized beige sweater, sitting on grey couch in dim warm living room, single soft lamp behind her. She holds an unbranded slimming tea sachet between fingers near her chest. She inhales softly, looks at camera with sincere vulnerable tone, dialog in Bahasa Melayu Malaysia: 'Honestly aku malu cerita—tapi aku turun empat kilo sebulan tanpa diet ketat.' Mouth precise lip-sync, slight emotional eye crease, gentle real smile at the end. Audio: ONE female voice, very faint room hum, NO music, NO subtitles, clean frame. Cinematic dim warm tones, real skin texture, no makeup.",
  },
  {
    id: "reel-12",
    label: "Outdoor · Lifestyle",
    prompt:
      "Vertical 9:16 handheld selfie. Attractive Malay woman in her 20s with soft black hijab and white linen shirt, walking slowly along a sunlit Kuala Lumpur park path, palm trees and morning joggers softly blurred behind. Bright clean morning light, slight wind moving her hijab. She lifts an unbranded sunscreen bottle into frame mid-stride, smiles warmly, dialog in Bahasa Melayu Malaysia with breezy upbeat tone: 'Aku tak keluar tanpa ni—kulit aku makin cerah, bukan hitam.' Mouth precise lip-sync, slight squint from sun. Audio: ONE female voice, faint outdoor breeze and distant birds, NO music, NO subtitles, clean frame. Authentic iPhone UGC, real skin with natural daylight glow.",
  },
  {
    id: "reel-13",
    label: "Beach · Sunset",
    prompt:
      "Vertical 9:16 cinematic handheld selfie. Attractive Malay woman in her 20s wearing flowy white maxi dress and soft cream hijab, standing on a Langkawi beach during golden sunset, ocean and palm silhouettes behind. Warm orange light wraps her face, slight wind in fabric. She holds an unbranded sunscreen bottle to camera, calm content smile, dialog in Bahasa Melayu Malaysia: 'Holiday wajib bawak ni—muka aku tak terbakar walaupun sunbathe satu hari.' Mouth precise lip-sync. Audio: ONE female voice, faint waves and gulls in distance, NO music, NO subtitles, clean frame. Cinematic shallow depth of field, real skin with sun glow.",
  },
  {
    id: "reel-14",
    label: "Mom · Morning routine",
    prompt:
      "Vertical 9:16 handheld iPhone UGC. Attractive Malay woman in her early 30s wearing soft mint green hijab and casual home dress, standing in bright kitchen with a four-year-old child playing with cereal in soft bokeh behind her. Morning sunlight floods the scene. She smiles tiredly but warmly at camera, holds up an unbranded vitamin bottle, dialog in Bahasa Melayu Malaysia: 'Mak-mak, kalau penat macam aku—try vitamin ni, tenaga balik dalam seminggu.' Mouth precise lip-sync. Audio: ONE female voice, faint child giggle in background, NO music, NO subtitles, clean frame. Authentic real-mom UGC vibe.",
  },
  {
    id: "reel-15",
    label: "Travel · Airport",
    prompt:
      "Vertical 9:16 handheld selfie. Attractive Malay woman in her 20s wearing oversized denim jacket and beige hijab, sitting at KLIA airport gate with a small carry-on suitcase beside her, plane visible through floor-to-ceiling windows. Cool airport ambient light. She holds an unbranded travel-size skincare bottle, excited light smile, dialog in Bahasa Melayu Malaysia: 'Sebelum naik flight, aku mesti pakai ni—kulit tak kering walaupun lapan jam dalam pesawat.' Mouth precise lip-sync. Audio: ONE female voice, faint distant airport announcement, NO music, NO subtitles, clean frame. Authentic iPhone UGC.",
  },
  {
    id: "reel-16",
    label: "Foodie · Reaction",
    prompt:
      "Vertical 9:16 handheld selfie. Attractive Malay woman in her late 20s wearing burgundy hijab and casual cardigan, sitting at a Penang mamak restaurant table with a plate of nasi lemak in front of her. Warm restaurant tungsten light, blurred patrons behind. She picks up an unbranded sambal jar, drizzles a spoonful onto the rice, takes a bite with eyes-closed reaction of pleasure, opens eyes wide to camera, dialog in Bahasa Melayu Malaysia: 'Mak aih—sambal ni level pro, aku beli sepuluh botol terus!' Mouth precise lip-sync. Audio: ONE female voice, faint restaurant clatter, NO music, NO subtitles, clean frame.",
  },
  {
    id: "reel-17",
    label: "ASMR · Product",
    prompt:
      "Vertical 9:16 cinematic close-up macro shot, no person on screen. An unbranded glass serum bottle with a gold dropper sits on a wet marble surface beside a fresh sliced orange and a sprig of rosemary. Dramatic side soft window light, water droplets glistening. The dropper lifts, a single golden droplet falls in slow motion onto the marble. Off-screen calm female voice in Bahasa Melayu Malaysia narrates softly: 'Satu titik je—muka kau glow sampai esok pagi.' Cinematic shallow depth of field, sharp focus on droplet. Audio: ONE single calm female voice (off-screen), faint water drip and glass clink ASMR, NO music, NO subtitles, clean frame. Photoreal commercial-quality cinematography.",
  },
  {
    id: "reel-18",
    label: "Bedtime · Calm",
    prompt:
      "Vertical 9:16 handheld iPhone UGC. Attractive Malay woman in her 20s with soft lilac silk hair scarf, wearing pastel pink pajama top, sitting cross-legged on bed in dim warm bedroom lit by single bedside lamp. She holds an unbranded night cream jar, gentle calm smile, dialog in Bahasa Melayu Malaysia in a soft sleepy tone: 'Sebelum tidur aku sapu ni—esok pagi muka licin macam baby.' Mouth precise lip-sync. Audio: ONE female voice, very faint room hum, NO music, NO subtitles, clean frame. Cozy intimate vibe, soft warm shadows, real skin with no makeup.",
  },
  {
    id: "reel-19",
    label: "Mirror · OOTD",
    prompt:
      "Vertical 9:16 mirror selfie style. Attractive Malay woman in her 20s in front of full-length bedroom mirror holding iPhone vertically, wearing chic beige co-ord set with soft cream hijab. She does a slight twirl, then steadies the phone, holds up an unbranded whitening cream bottle to mirror, confident smile, dialog in Bahasa Melayu Malaysia: 'Korang perasan tak—dua minggu je muka aku dah cerah dua tone.' Bright clean window daylight, minimalist bedroom in soft bokeh. Mouth precise lip-sync. Audio: ONE female voice, faint room ambience, NO music, NO subtitles, clean frame. Authentic iPhone mirror UGC.",
  },
  {
    id: "reel-20",
    label: "Cafe · Friends",
    prompt:
      "Vertical 9:16 handheld selfie. Two attractive Malay women in their 20s sitting at a sunny cafe corner table with lattes—one wearing soft pink hijab, one with wavy hair no hijab. The hijabi holds the phone selfie-style, both lean in smiling. The hijabi holds up an unbranded slimming tea sachet, dialog in Bahasa Melayu Malaysia: 'Aku cerita kat dia pasal teh ni—dia tak percaya sampai try sendiri.' The friend nods enthusiastically beside her. Warm cafe daylight, plants in soft bokeh. Mouth precise lip-sync on speaker. Audio: ONE female voice (speaker), faint cafe murmur, NO music, NO subtitles, clean frame. Authentic friendship vibe iPhone UGC.",
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
