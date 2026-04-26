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

// ─── 20 distinct UGC styles to showcase Veo 3.1's range for the landing reel.
// CRITICAL PACING RULE built into every prompt: dialog fills the full 8 seconds
// at natural Malaysian TikTok creator pace (~22-26 words), starts at frame 1,
// ends at last frame, NO slow drag, NO awkward pauses, NO trailing silence.
const PACING = "CRITICAL: Speech is continuous from frame 1 to last frame at natural fast Malaysian TikTok creator pace. NO slow drag, NO awkward pauses, NO trailing silence. Mouth lip-syncs precisely with every syllable across the full 8 seconds.";

const VIDEO_PROMPTS = [
  {
    id: "reel-1",
    label: "Bestie · Skincare",
    prompt:
      "EXTREME CLOSE-UP shot, vertical 9:16, face fills 80% of frame, handheld iPhone selfie. Attractive Malay woman in her 20s wearing soft beige hijab, sitting at bedroom vanity in golden hour daylight. Camera held very close to her face — eyes, cheeks and lips dominate the frame. She holds a small unbranded serum bottle peeking into bottom of frame, leans into camera with warm bestie energy, fast-paced direct delivery in natural Bahasa Melayu Malaysia: 'Eh korang serius—aku try serum ni tiga hari je, muka dah tak kering, pori-pori pun nampak tertutup, korang kena cuba!' Real skin texture with visible pores, no-makeup-makeup, lived-in vanity bokeh. Audio: ONE female voice, energetic confident bestie tone, faint room tone, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-2",
    label: "Kitchen · Sambal",
    prompt:
      "MEDIUM-WIDE SHOT, vertical 9:16, full kitchen environment visible. Camera placed on counter opposite the stove, capturing the woman from waist-up with kitchen depth behind — wok, herbs, hanging utensils, window light streaming through. Attractive Malay woman in her 30s with casual loose hair, light apron, stirring glistening stir-fry noodles, then turns to camera holding an unbranded sambal jar. Steam rises beautifully. Confident half-smile, fast-paced dialog in Bahasa Melayu Malaysia: 'Last week kawan aku try sambal ni masa makan kat rumah—dia call balik tanya kat mana aku beli sebab pedas dia berlapis-lapis!' Warm tungsten kitchen lights, lived-in cluttered counter. Audio: ONE female voice, soft wok sizzle, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-3",
    label: "Gym · Supplement",
    prompt:
      "LOW ANGLE SHOT, vertical 9:16, camera placed on the gym floor looking up. Attractive Malay man in his late 20s wearing fitted black sports tee, biceps and shoulders prominent from this dramatic upward perspective, slight sweat on forehead glistening under warm late-afternoon window light. He stands beside a bench, holds an unbranded supplement bottle, looks down into camera with calm confident energy, fast paced dialog in Bahasa Melayu Malaysia: 'Aku try supplement ni tiga minggu—perform memang naik, tenaga aku tahan sampai set last, recovery pun cepat, korang faham!' Industrial gym ceiling and overhead lights visible above him, dumbbells in foreground bokeh. Audio: ONE male voice, faint weight clinks, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-4",
    label: "In-car · Driving CTA",
    prompt:
      "WIDE INTERIOR DASHCAM SHOT, vertical 9:16, camera mounted on dashboard showing full car interior — steering wheel, both side windows, sunroof, ceiling. Attractive Malay woman in her 20s wearing dusty pink hijab seated in driver seat, full upper body visible plus passenger seat with bag and skincare bottle. Bright daylight through windshield, palm trees blurring past. She picks up the unbranded skincare bottle, holds it up confidently, fast playful dialog in Bahasa Melayu Malaysia: 'Aku selalu lupa touch up bila keluar—sekarang aku simpan dalam kereta, trafik jam je sapu sikit, terus glow balik, convenient gila!' Audio: ONE female voice, faint AC hum, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-5",
    label: "Vintage VHS · Unbox",
    prompt:
      "OVER-THE-SHOULDER POV SHOT, vertical 9:16, 90s VHS camcorder aesthetic with chromatic aberration, tape grain, date timestamp '04-26-1996' in corner, washed-out colors. Camera looks over the woman's shoulder down at her hands tearing open a brown parcel on her lap. Attractive Malay woman in her late 20s with retro 90s big curly hair, oversized denim jacket. We see her hands pulling out an unbranded skincare bottle. She lifts it up to her face, half-turns back to camera, bubbly nostalgic fast delivery in Bahasa Melayu Malaysia: 'Akhirnya sampai gak parcel ni—aku tunggu dua minggu, kawan-kawan dah preview banyak kali, korang kena try, swear best gila!' Warm tungsten lamp, retro posters in bokeh. Audio: ONE female voice with slight tape compression, faint paper rustle, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-6",
    label: "Office · Vitamin C",
    prompt:
      "3/4 SIDE PROFILE SHOT, vertical 9:16, camera positioned 45 degrees to her right side. Attractive Malay woman in her late 20s wearing modest navy blazer and navy hijab, seated at tidy office desk. Soft midday window daylight rakes across her face from the left, creating gorgeous side-light cheekbone definition and a soft halo on the hijab edge. MacBook and ceramic coffee cup visible in foreground, glass office partition in soft bokeh background. She turns slightly toward camera holding an unbranded vitamin bottle, calm confident fast pace in Bahasa Melayu Malaysia: 'Aku pakai vitamin ni dah enam bulan—masa musim flu langsung tak sakit, boss aku pun perasan, dia tanya rahsia aku apa, hehe!' Audio: ONE female voice, faint office ambience, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-7",
    label: "Cartoon · Anime UGC",
    prompt:
      "WIDE ESTABLISHING SHOT, vertical 9:16 anime-style cel-shaded animation, Studio Ghibli meets modern Korean webtoon aesthetic. Camera shows the entire pastel pink anime bedroom — bed with plushies, vanity desk, floating sparkles, window with cherry blossoms outside. Cute young Malay anime girl character with soft beige hijab, large expressive brown eyes, light blush, stands center frame holding a stylized cartoon skincare bottle. She does a tiny twirl, eyes flash to sparkly hearts as she presents the bottle, fast cute upbeat delivery in Bahasa Melayu Malaysia: 'Korang serius kena cuba—muka aku glow gila lepas pakai serum ni satu minggu je, mama aku pun tanya aku makeup ke apa ni!' Crisp 2D animation, vibrant pastels, kawaii energy, animated mouth lip-sync. Audio: ONE bright female voice with light Malaysian accent, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-8",
    label: "Talking Product · 3D",
    prompt:
      "EXTREME MACRO CLOSE-UP, vertical 9:16 photoreal CGI 3D animation. Camera so close to the bottle that its label area fills 70% of the frame — every detail of cap threading, droplet condensation, label paper texture is visible. A small unbranded white skincare serum bottle sits on a marble bathroom counter, with cute large cartoon eyes and an animated mouth on its label. The bottle bobs and tilts side-to-side, mouth animates with precise lip-sync. Cheerful fast playful dialog in Bahasa Melayu Malaysia: 'Hai sayang! Aku akan buat muka kau glow dalam tujuh hari—kalau tak puas hati, refund je, aku berani janji, aku bottle yang amanah!' Pixar-quality lighting, subsurface scattering, soft bathroom bokeh behind. Audio: ONE playful female voice, faint bathroom reverb, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-9",
    label: "Cafe · Aspirational",
    prompt:
      "WIDE CINEMATIC ENVIRONMENT SHOT, vertical 9:16, 35mm film aesthetic. Camera placed across the room — woman small in frame, shown sitting at a sunlit cafe window seat with the entire cafe environment visible: hanging plants, exposed brick, other patrons in deep bokeh, warm wood tones. Attractive Malay woman in her 20s with shoulder-length wavy hair, no hijab, soft cream knit cardigan, latte mug and unbranded premium serum bottle on wooden table. Golden window light streams in from screen left creating a halo. Camera slowly pushes in. She looks toward lens, calm confident fast lifestyle delivery in Bahasa Melayu Malaysia: 'Setiap pagi aku mula dengan ni—glow yang real, bukan filter, bukan makeup, dah jadi habit aku, tak boleh skip walaupun sehari!' Audio: ONE female voice, faint cafe murmur, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-10",
    label: "Comedy · Reaction",
    prompt:
      "TIGHT MIRROR REFLECTION CLOSE-UP, vertical 9:16, camera shoots the bathroom mirror reflection — we see the man's face in the mirror plus his hand holding up the iPhone capturing the reflection. Frame is tight on his upper face: forehead, hairline, wide eyes. Attractive Malay man in his early 30s, casual home tee, ruffled bedhead hair. He stares at his hairline in shock, eyebrows shoot up, then snaps eyes to camera with exaggerated comedic surprise, lifts up an unbranded hair growth oil bottle into frame. Fast surprised playful delivery in Bahasa Melayu Malaysia: 'Eh apa ni serius?! Dua minggu je rambut aku tumbuh balik—aku sangka dah bald selamanya, rupanya minyak ni jalan, korang lelaki kena try!' Bright bathroom LED, white tiles. Audio: ONE male voice, faint bathroom reverb, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-11",
    label: "Confession · Story",
    prompt:
      "MEDIUM CLOSE-UP, vertical 9:16, eye-level intimate framing — head and shoulders, slight headroom. Attractive Malay woman in her late 20s wearing soft maroon hijab and oversized beige sweater, sitting on grey couch in dim warm living room. Single warm lamp behind creates rim light on her hijab edge. She holds an unbranded slimming tea sachet between fingers near her chest. Sincere vulnerable but fast-paced delivery in Bahasa Melayu Malaysia, eyes earnest: 'Honestly aku malu cerita—tapi aku turun empat kilo sebulan tanpa diet ketat, just minum teh ni dua kali sehari, kerja dia memang real!' Slight emotional eye crease, gentle smile at end. Cinematic dim warm tones, real skin no makeup. Audio: ONE female voice, faint room hum, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-12",
    label: "Stop-motion · Clay magic",
    prompt:
      "TOP-DOWN BIRDS-EYE SHOT, vertical 9:16 stop-motion claymation animation, Aardman Studios style, visible clay fingerprints, slight frame jitter on every motion. Camera looks straight DOWN onto a miniature pastel-colored clay tabletop scene — tiny clay vanity table, miniature clay flowers, cute clay female character with maroon hijab and big round eyes lying on a tiny clay rug looking up at camera. A small clay skincare bottle bounces into frame from screen edge. She sits up, picks it up, applies a clay dollop on her cheek, looks straight up at the bird's-eye camera with shocked-then-delighted face. Cheerful fast exaggerated delivery in Bahasa Melayu Malaysia: 'Ya Allah—muka aku glow tak ingat, korang wajib try, aku pakai pagi malam, dua minggu je kulit dah halus macam baby!' Chunky claymation lip-sync. Audio: ONE playful female voice, soft handcraft sound, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-13",
    label: "Beach · Sunset",
    prompt:
      "WIDE LANDSCAPE CINEMATIC SHOT, vertical 9:16, anamorphic 35mm film aesthetic. Camera placed far back showing the woman small in frame against a vast Langkawi beach landscape — endless ocean, palm tree silhouettes, dramatic sunset sky filling the upper half of frame with orange-pink-purple gradient. Attractive Malay woman in her 20s wearing flowy white maxi dress and soft cream hijab, walking slowly toward camera, hijab and dress fluttering in sea breeze. As she approaches, she lifts an unbranded sunscreen bottle into frame. Calm content fast delivery in Bahasa Melayu Malaysia: 'Holiday wajib bawak ni—muka aku tak terbakar walaupun sunbathe satu hari, aku dah test masa Bali trip, memang protect betul-betul!' Audio: ONE female voice, faint waves and gulls, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-14",
    label: "Mom · Morning routine",
    prompt:
      "WIDE KITCHEN SHOT, vertical 9:16, camera placed across the kitchen showing the entire morning scene. Bright sunny kitchen with full table, breakfast spread (cereal, toast, fruit), four-year-old Malay child sitting at the table eating, mom standing at the counter. Attractive Malay woman in her early 30s wearing soft mint green hijab and casual home dress. Morning sunlight floods through window. She turns from counter holding an unbranded vitamin bottle, fast tired-but-warm delivery in Bahasa Melayu Malaysia: 'Mak-mak, kalau penat layan anak macam aku—try vitamin ni, tenaga balik dalam seminggu, sekarang aku boleh handle tiga budak tanpa nak nap!' Mouth lip-sync precise. Audio: ONE female voice, faint child giggle, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-15",
    label: "POV · GoPro routine",
    prompt:
      "FIRST-PERSON POV GOPRO CHEST-MOUNT, vertical 9:16, slight fish-eye distortion at edges. Camera looks down and forward from the wearer's chest — we see her hands and the marble bathroom counter from her own perspective. Hands pick up an unbranded glass serum bottle, unscrew the gold dropper, dispense 3 golden drops onto fingertips, then pat onto her own cheeks visible in a mirror at the top of frame. Bright natural bathroom daylight, white tiles, plant in corner. Off-screen confident fast voiceover in Bahasa Melayu Malaysia: 'Setiap pagi—satu titik, dua tepuk pipi, muka aku siap glow seharian tanpa makeup, dah sebulan aku rutin ni, kulit aku reborn!' Realistic hand close-ups, real skin texture. Audio: ONE female voiceover, faint water drip, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-16",
    label: "Foodie · Reaction",
    prompt:
      "OVER-THE-SHOULDER EATING ANGLE, vertical 9:16, camera placed behind and to her right shoulder, looking down at the plate of nasi lemak in foreground with her face visible past her shoulder. Attractive Malay woman in her late 20s wearing burgundy hijab and casual cardigan at a Penang mamak restaurant. Warm restaurant tungsten light, patrons in deep bokeh behind. She picks up an unbranded sambal jar, drizzles spoonful onto the rice (visible in foreground), then turns her face back toward camera with eyes-closed pleasure, opens wide and fast delivery in Bahasa Melayu Malaysia: 'Mak aih—sambal ni level pro, aku beli sepuluh botol terus untuk stock, seriously sedap, taste dia macam buatan mak aku sendiri!' Audio: ONE female voice, restaurant clatter, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-17",
    label: "ASMR · Product",
    prompt:
      "EXTREME MACRO CINEMATIC SHOT, vertical 9:16, no person on screen, no human anywhere. Camera so close to the bottle that condensation droplets and label fiber texture are visible. An unbranded glass serum bottle with gold dropper sits on a wet marble surface beside a fresh sliced orange and rosemary sprig. Dramatic side window light, water droplets glistening like jewels. The dropper lifts in slow motion, a single golden droplet hangs then falls onto the marble with a soft splash. Camera slowly dollies around the bottle. Off-screen calm confident fast female voiceover in Bahasa Melayu Malaysia: 'Satu titik je—muka kau glow sampai esok pagi, tujuh hari kau akan nampak beza, aku tak perlu cakap banyak, biar produk yang bercakap!' Audio: ONE female voiceover, faint water drip and glass clink ASMR, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-18",
    label: "Documentary · Interview",
    prompt:
      "MEDIUM CLOSE-UP BROADCAST INTERVIEW FRAMING, vertical 9:16, professional 35mm film look, shallow depth of field. Camera at perfect interview eye-level, head and chest framing with rule-of-thirds composition (subject offset slightly to left). Attractive Malay woman in her late 30s wearing soft taupe hijab and warm beige knit cardigan, seated on chic dark green velvet armchair in softly-lit minimalist studio. Cinematic three-point lighting with warm key light camera-left, gentle blue rim light camera-right. She looks slightly off-camera at interviewer, holds an unbranded slimming tea sachet on lap. Sincere measured but FAST-paced testimony in Bahasa Melayu Malaysia: 'Saya cuba banyak produk—ni yang first kali betul-betul jadi, turun lima kilo dalam masa sebulan, tak payah diet, just ikut routine je!' Mouth precise lip-sync, subtle authentic emotion. Audio: ONE female voice, broadcast lavalier clarity, faint room tone, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-19",
    label: "Before / After · Split",
    prompt:
      "SYMMETRIC SPLIT-SCREEN COMPOSITION, vertical 9:16, both halves shot at identical medium close-up framing. LEFT half labeled 'HARI 1' (subtle small text bottom left) shows Malay woman in her late 20s with dull tired skin, slight under-eye darkness, no makeup, flat overhead lighting. RIGHT half labeled 'HARI 30' shows the SAME woman with visibly clearer brighter glowing skin, gentle smile, soft warm golden side-light. After 2 seconds, smooth animated wipe transition reveals the right half fully, then both halves merge into ONE centered medium-close-up shot of her holding an unbranded skincare bottle. Proud confident fast delivery in Bahasa Melayu Malaysia: 'Tiga puluh hari je—kulit aku tukar level, dari kusam sampai glow, korang tengok sendiri perbezaan, gambar tak tipu, semua natural je!' Real skin texture both sides. Audio: ONE female voice, soft whoosh, NO music, NO subtitles. " + PACING,
  },
  {
    id: "reel-20",
    label: "Hyperreal · Splash hero",
    prompt:
      "DRAMATIC DOLLY-IN COMMERCIAL SHOT with multi-angle reveal, vertical 9:16 hyperreal slow-motion luxury TVC. Camera starts WIDE with the bottle small in frame against deep gradient orange-to-cream, then dollies in dramatically while orbiting 45 degrees to end at a low-angle hero close-up by the final second. An unbranded glossy white skincare serum bottle floats mid-air. A massive crystal-clear water splash erupts around it in extreme slow motion (1000fps feel), individual droplets suspended like jewels. Dramatic studio rim light from behind, soft fill from front. Off-screen confident fast female voiceover in Bahasa Melayu Malaysia: 'Satu botol—tujuh hari—muka kau berubah, tak perlu skincare berlapis-lapis, ni je dah cukup, trust formula, hasil sendiri akan bercakap nanti!' Octane render quality, photoreal water physics. Audio: ONE confident female voiceover, cinematic water splash sound, NO music, NO subtitles. " + PACING,
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
