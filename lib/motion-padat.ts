// Motion Default · "Padat · Lambat": the same Edit Video / Buat Iklan inputs as
// "Laju · Ringkas" (Remotion templates), but Claude Code builds the video on
// HyperFrames in modal_vgc.py (mode "edit" / "ad"), with the independent-critic
// loop and the loudness master. Slower (~20–40 min), richer motion.
//
// Edit Video keeps its step 1 on the Laju renderer (transcript + captions for
// the client's review); only step 2 ("Jana Video") and Resubmit build on Padat.
// Buat Iklan: Claude Code writes the voice-over itself (pl-tts → /api/vgc/tts
// with the row's own token in metadata.padat.tts).

import { createAdminClient } from "@/lib/supabase/admin";
import { failMotionRow, MOTION_EDIT_MAX_SEC, MOTION_VOICES, siteUrl, vgcStart, type AdInput, type EditInput } from "@/lib/motion";
import { motionStyle } from "@/lib/motion-styles";
import { vgcPricing } from "@/lib/vgc";

/** The least a Padat video costs (the Custom Style video price; the per-second
 *  rate applies when it is higher). Free accounts (rate 0) pay nothing. */
export async function padatMin(rate: number): Promise<number> {
  return rate > 0 ? (await vgcPricing()).video : 0;
}

const CTA_DEFAULT = "Tekan beg kuning sekarang";

const langLine = (l: string | undefined) =>
  l === "en" ? "English (natural, conversational)"
    : l === "auto" ? "the same language as spoken in the footage"
      : "Bahasa Melayu Malaysia — natural, santai, bukan baku";

const styleLine = (style: string | undefined, accent: string | undefined) => {
  const s = motionStyle(style);
  return `${s.label} — ${s.desc} (palette: ${accent ? `aksen ${accent}` : s.palette})`;
};

const GUARD_LINE =
  "PATUH GARIS PANDUAN TIKTOK SHOP: tiada dakwaan perubatan / kesihatan berlebihan (sembuh, ubat, rawat, jamin, 100%), " +
  "tiada perbandingan sebelum/selepas badan, tiada teks berisiko pada skrin; teks berisiko pada gambar produk ditutup dengan pelekat.";

/** Brief for an Edit Video built on Padat: the client's reviewed cut + script. */
export function editBrief(input: EditInput, durSec: number, photos: number): string {
  const caps = input.captions
    ? `KAPSYEN: WAJIB — guna perkataan dalam ./bahan/captions.json TEPAT seperti yang klien sahkan (jangan ubah ejaan, jangan tambah atau buang perkataan), ` +
      `selari dengan masa t/e setiap perkataan, gaya "${input.captionStyle || "pop"}" (pop / karaoke / box / tiktok), ` +
      `${input.captionPos === "mid" ? "di tengah skrin" : "di bahagian bawah-tengah, di atas zon butang TikTok"}; jangan tutup muka atau produk.`
    : "KAPSYEN: TIADA kapsyen perkataan demi perkataan. Teks grafik ringkas (hook, kata kunci, CTA) dibenarkan — ambil perkataannya daripada ./bahan/captions.json.";
  const music = input.auto ? "MUZIK: pilih sendiri sama ada perlu (jika ya: pl-music, perlahan di bawah suara)."
    : input.music ? "MUZIK: ya — `pl-music --sec <tempoh> --speech ./bahan/footage.mp4`, perlahan di bawah suara asal."
      : "MUZIK: tiada muzik latar.";
  const sfx = input.sfx ? "SFX: ya — pada transisi dan elemen yang masuk, jelas tetapi tidak mengganggu suara." : "SFX: tiada SFX.";
  return [
    "Edit video TikTok Shop daripada footage klien — tahap motion designer profesional.",
    "",
    `PRODUK: ${input.product || "(lihat skrip)"} — guna ejaan ini.`,
    `FOOTAGE: ./bahan/footage.mp4 (${durSec.toFixed(1)}s, 1080x1920, 30fps) — SUDAH dipotong (jump cut) seperti yang klien semak. ` +
      "Ia lapisan asas: guna keseluruhannya dari awal hingga akhir mengikut urutan — jangan potong, jangan ubah kelajuan; " +
      "suara asal kekal jelas sepanjang video. Motion graphics di atasnya menyokong apa yang sedang dikatakan.",
    "SKRIP: ./bahan/captions.json = perkataan pertuturan yang klien sahkan, [{w, t, e}] dalam saat pada footage.",
    caps,
    `GAMBAR PRODUK: ./bahan/produk/ (${photos} gambar asli klien) — tunjukkan produk dengan jelas (kad produk / panel / B-roll) ` +
      "bila produk disebut; jangan herot, jangan potong teruk, jangan guna gambar produk lain.",
    input.auto ? "GAYA: pilih sendiri gaya, warna dan tenaga yang paling sesuai dengan video ini." : `GAYA: ${styleLine(input.style, input.accent)}.`,
    ...(input.instructions ? [`ARAHAN KLIEN: ${input.instructions}`] : []),
    music,
    sfx,
    `CTA AKHIR: "${CTA_DEFAULT}" (kecuali skrip menyebut CTA lain) — boleh dibaca sekurang-kurangnya 1.5 s.`,
    "FAKTA: hanya apa yang disebut dalam skrip dan nama produk. Jangan reka harga, tawaran, testimoni, dakwaan atau nombor.",
    ...(input.guard ? [GUARD_LINE] : []),
    `BAHASA TEKS: ${langLine(input.language)}.`,
    "KUALITI: hook kuat dalam 2 saat pertama (daripada ayat pertama skrip), kinetic type untuk kata kunci, kad produk, ikon, " +
      "transisi kemas, tiada teks bertindih, semua dalam safe area TikTok.",
    `FORMAT: 1080x1920, 30 fps, tempoh sama dengan footage (${durSec.toFixed(1)}s).`,
    "Output: ./out/preview.mp4",
  ].join("\n");
}

/** Brief for a Buat Iklan ad built on Padat (no footage: all motion graphics + AI voice). */
export function adBrief(input: AdInput, photos: number): string {
  const voice = MOTION_VOICES.find((v) => v.key === input.voice)?.label || "Mira";
  const words = Math.round((input.seconds || 30) * 2.3);
  const variant = input.variant && input.variant.total > 1
    ? [`VARIASI: ini variasi ${input.variant.index + 1} daripada ${input.variant.total} — guna hook dan sudut cerita yang BERBEZA ` +
       "(contoh: 1 = masalah → penyelesaian, 2 = demo / manfaat, 3 = tawaran / urgensi)."]
    : [];
  return [
    "Bina iklan video TikTok Shop — motion graphics sepenuhnya dengan kod (tiada footage), tahap profesional.",
    "",
    `PRODUK: ${input.product}`,
    `PENERANGAN (satu-satunya sumber fakta): ${input.description}`,
    input.price ? `HARGA: RM${input.price}${input.oldPrice ? ` (harga asal RM${input.oldPrice})` : ""}` : "HARGA: tiada — jangan sebut harga.",
    `CTA: "${input.cta || CTA_DEFAULT}"${input.handle ? ` · akaun @${input.handle.replace(/^@/, "")}` : ""}`,
    ...(input.audience ? [`AUDIENS: ${input.audience}`] : []),
    ...(input.vibe ? [`VIBE: ${input.vibe}`] : []),
    `GAYA: ${styleLine(input.style, input.accent)}.`,
    ...(input.extra ? [`ARAHAN TAMBAHAN: ${input.extra}`] : []),
    photos
      ? `GAMBAR: ./bahan/produk/ (${photos} gambar asli klien) — tunjukkan produk dengan jelas dan besar, jangan herot, jangan guna gambar produk lain.`
      : "GAMBAR: tiada — bina visual dengan tipografi, bentuk dan ikon sahaja; jangan reka rupa produk.",
    `TEMPOH: ~${input.seconds || 30}s (±3s).`,
    `BAHASA: ${langLine(input.language)}.`,
    `VOICE-OVER: suara AI "${voice}" (izin klien diberi). Tulis skrip VO ~${words} patah perkataan, pecah ikut ayat, ` +
      `jana setiap ayat: \`pl-tts --out ./bahan/vo-01.mp3 --speed ${input.speed ?? 1} "Ayat."\`, sambung dengan pl-vo-track ` +
      "dan masa setiap babak ikut start yang dicetak.",
    input.captions
      ? `KAPSYEN: ya — ikut ayat VO, tepat sama dengan apa yang dituturkan, gaya "${input.captionStyle || "pop"}".`
      : "KAPSYEN: tiada kapsyen VO; teks grafik ringkas sahaja.",
    input.music ? "MUZIK: ya — pl-music, perlahan di bawah VO." : "MUZIK: tiada muzik latar.",
    input.sfx ? "SFX: ya — pada transisi dan elemen yang masuk." : "SFX: tiada SFX.",
    ...variant,
    "FAKTA: hanya daripada penerangan di atas. Jangan reka harga, tawaran, testimoni, dakwaan, rating atau nombor.",
    ...(input.guard ? [GUARD_LINE] : []),
    "FORMAT: 1080x1920, 30 fps.",
    "Output: ./out/preview.mp4",
  ].join("\n");
}

const photoName = (url: string, i: number) => {
  const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  return `produk-${i + 1}.${["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg"}`;
};

type DraftLike = { words?: Array<{ w?: unknown; t?: unknown; e?: unknown }>; segs?: unknown; kept?: unknown };

/** Step 2 / Resubmit of an Edit Video on Padat. `step` names the output file
 *  ("v1", "r1"…); `ws` the Modal workspace (fresh per run). */
export async function startPadatEdit(o: { id: string; userId: string; input: EditInput; draft: DraftLike; step: string; ws: string }) {
  const photos = (o.input.productImages || []).slice(0, 5);
  const dur = Math.min(Number(o.draft.kept) || Number(o.input.durationSec) || 0, MOTION_EDIT_MAX_SEC);
  const brief = editBrief(o.input, dur, photos.length);
  return vgcStart({
    mode: "edit",
    history_id: o.id,
    user_id: o.userId,
    ws_id: o.ws,
    prompt: brief,
    brief,
    video_url: o.input.videoUrl,
    segs: Array.isArray(o.draft.segs) ? o.draft.segs : null,
    words: (o.draft.words || []).map((w) => ({ w: w.w, t: w.t, e: w.e })),
    max_sec: MOTION_EDIT_MAX_SEC,
    materials: photos.map((url, i) => ({ url, name: photoName(url, i) })),
    expect_video: true,
    step: o.step,
  });
}

/** Start one Buat Iklan row on Padat (called after the row + credit hold exist). */
export async function startPadatAdRow(id: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, status, metadata").eq("id", id).maybeSingle();
  if (!row || row.status !== "pending") return;
  const meta = (row.metadata || {}) as { input: AdInput; padat?: { tts?: { voice: string; token: string } } };
  const input = meta.input;
  const tts = meta.padat?.tts;
  const images = (input.images || []).slice(0, 4);
  const brief = adBrief(input, images.length);
  const start = await vgcStart({
    mode: "ad",
    history_id: id,
    user_id: row.user_id,
    ws_id: id,
    prompt: brief,
    brief,
    materials: images.map((im, i) => ({ url: im.url, name: (im.role === "presenter" ? "presenter-" : "") + photoName(im.url, i) })),
    expect_video: true,
    step: "v1",
    ...(tts ? { tts: { url: `${siteUrl()}/api/vgc/tts`, token: tts.token, voice: tts.voice } } : {}),
  });
  if (!start.ok) {
    await failMotionRow(row, `Gagal mula (Padat): ${start.error}`.slice(0, 500));
    return;
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  await admin
    .from("history")
    .update({ task_id: start.callId, metadata: { ...(cur?.metadata || meta), stage: "queued", provider: "modal-vgc" } })
    .eq("id", id)
    .eq("status", "pending");
}
