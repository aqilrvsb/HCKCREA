# GROK IMAGINE 1.5 — ALGORITMA & LOGIK PENUH (PeningLab)

> Sumber: sesi engineering Auto UGC PeningLab, 2026-07-06. Semua rule di bawah
> telah live-tested (3 video × 30s, SKINTIFIC) dan enforced dalam kod backend.

## 1. ASAS GROK — apa dia boleh & tak boleh

- Grok Imagine 1.5 = **image-to-video (i2v) SAHAJA**. TIADA text-to-video.
  Setiap klip WAJIB bermula dari satu gambar = **START FRAME**.
- Maksimum **15 saat per klip**.
- Grok hanya **ANIMATE** frame yang dibagi: gerak mulut (lip-sync dialog),
  gesture, gerakan badan kecil, push-in/handheld drift halus.
- Grok **TIDAK BOLEH**: tukar angle kamera, tukar baju, tukar lokasi, tambah
  objek baru, ubah saiz/label produk. Apa yang TIADA dalam frame, TAKKAN
  muncul dalam video.
- Pacing dialog: **~3 patah perkataan Melayu / saat** (10s ≈ 30 patah,
  15s ≈ 45 patah). Kurang = mulut freeze di hujung; lebih = audio terpotong.

## 2. START FRAME = NYAWA (prinsip paling penting)

> "Generate gambar sangat memainkan peranan" — frame ialah DNA video.

Semua keputusan kreatif dibuat di peringkat GAMBAR (Banana Pro 2 /
nano-banana-pro), BUKAN di prompt video Grok:
- Avatar (muka, tudung, umur) → dalam gambar
- Outfit → dalam gambar
- Scene/lokasi/lighting → dalam gambar
- **Angle kamera → dalam gambar** (Grok tak boleh re-frame)
- Kedudukan & saiz produk → dalam gambar

Prompt video Grok hanya bawa: dialog (dalam petikan tunggal), SATU aksi
mudah, dan arahan konsistensi ("same person, same outfit") + anatomy lock.

## 3. KENAPA BANANA PRO 2 (bukan GPT Image 2) untuk start frame

- Banana **ukur saiz produk dari gambar rujukan** (tangan pegang = pembaris
  skala). GPT Image ambil saiz dari prompt → produk kerap besar/kecil pelik.
- Banana copy produk **pixel-exact** (label, typography, bentuk). GPT Image
  cenderung lukis semula → label drift.
- Banana stabil dengan multi-reference (avatar + 3 gambar produk).

### Rule 3 attachment (WAJIB untuk saiz betul):
1. **Gambar 1: tangan pegang produk TANPA muka** → AI baca exact size.
2-3. **Gambar produk RAW** — tiada harga/pakej/objek lain. Naked product.

### Role-split rujukan (setiap kali jana frame):
- IMAGE 1 = identiti avatar (muka/rambut LOCK — jangan ubah).
- Gambar produk = rujukan **warna/label/bentuk SAHAJA** — abaikan
  background gambar produk tu sendiri. Produk mesti pixel-identical.

## 4. DURASI & SPLIT (balanced halves)

| Permintaan klien | Output |
|---|---|
| ≤ 15s | 1 klip Grok |
| 20s | 2 segmen: 10s + 10s |
| 30s | 2 segmen: 15s + 15s |

Pilihan tetap PeningLab: **10s / 15s / 20s (10+10) / 30s (15+15)**.

## 5. LOGIK 2 SEGMEN — "ANGLE CUT" (bukan scene berbeza!)

Segmen 1 dan Segmen 2 = **SCENE YANG SAMA** — avatar sama, outfit sama,
bilik sama, lighting sama, kedudukan produk sama. Yang berubah HANYA
**angle kamera** — macam editor video sebenar cut ke angle lain mid-take.

### Cara jana frame Seg 2 (teknikal):
Frame Seg 2 dijana dengan **frame Seg 1 sebagai rujukan utama** + arahan:
*"THE ONLY CHANGE IS THE CAMERA ANGLE — re-shoot moment yang sama dari
angle baru. Ubah TIADA APA-APA selain angle."* + rujukan produk.
(Ini jaminan kod-level bahawa bilik/baju/muka betul-betul sama.)

### Angle bank yang DIBENARKAN (avatar sedang BERCAKAP ke kamera):
- Saiz shot: close-up (CU), medium close-up (MCU), medium shot (MS)
- Ketinggian: eye-level, SEDIKIT tinggi, SEDIKIT rendah (subtle sahaja)
- Orientasi: depan, 3/4 angle, selfie-handheld POV

### Pasangan cut Seg1 → Seg2 yang proven:
1. Medium shot → close-up (punch-in klasik untuk payoff/CTA)
2. Selfie handheld → medium shot statik
3. Eye-level medium → sedikit low angle (beat keyakinan)
4. Depan → 3/4 angle
5. Medium shot → MCU produk diangkat SEBELAH muka (muka tetap ke kamera)

### Angle HARAM (menyebabkan anomali grotesque — dah kena sekali):
- Overhead / top-down / bird's-eye (kamera atas kepala → leher terdongak pelik)
- Worm's-eye ekstrem, dari belakang, side profile (mulut tersembunyi)
- Extreme close-up bahagian muka
- Mana-mana angle yang tunjuk atas kepala / paksa leher senget
**Setiap frame: muka TEGAK, dagu paras, mata ke arah kamera** — macam
orang betul rakam diri sendiri.

### Anatomy lock (append pada SETIAP frame + video prompt):
"Anatomically perfect: two hands, five fingers each, natural neck and
upright posture, face level toward camera. No head-spinning, no body
warping, no extra limbs."

## 6. DIALOG BERSAMBUNG (continuous script)

- SATU skrip penuh dipecah ikut segmen — **Seg 1 habis tergantung
  (mid-thought)**, Seg 2 sambung TEPAT dari situ. Macam satu take dipotong dua.
- Jangan ulang beat. **CTA hanya di segmen TERAKHIR** (cth "tekan beg kuning").
- Suara sama, orang sama, outfit sama — hanya scene-angle + ayat berubah.
- Word target per segmen = saat × 3 (Seller/TikTok pacing).
- Dialog mesti selari dengan cut: kalau Seg 1 habis "...jap aku tunjuk
  hasilnya", angle Seg 2 mesti angle di mana payoff tu nampak.

## 7. PRODUK MESTI KELIHATAN (visible lock)

Dalam SETIAP frame (Seg 1 DAN Seg 2): produk jelas nampak — dalam tangan
(label ke kamera), diangkat dekat muka, sedang disapu/diguna, atau dipakai
(wearable). **TIDAK BOLEH** frame avatar kosong tanpa produk.

## 8. AVATAR — Kekal vs Dynamic

- **Avatar Kekal** (default): SATU muka untuk semua video dalam batch.
  Satu gambar base avatar dijana dulu (avatar + produk); semua frame
  rujuk gambar tu untuk kunci identiti.
- **Avatar Dynamic**: muka BERBEZA setiap video (kriteria jantina/style/
  umur sama). Dalam satu video, muka tetap konsisten (Seg 2 anchor frame Seg 1).
- Avatar upload sendiri (existing) = sentiasa kekal.

### Muka TIDAK PERNAH hardcode — AI roll kombinasi baru setiap kali:
- Bentuk muka: oval / bulat / sembung / hati / panjang / diamond / rahang lembut / tegas
- Makeup: natural / dewy Korean / soft glam / matte minimal / bold lip / earth-tone / barefaced
- Skin tone Malaysia: cerah / cerah kekuningan / sederhana / sawo matang / gelap manis
- Mata, kening, hidung, bibir, ciri unik (lesung pipit, beauty mark, dll)

### Outfit rule:
- Dalam SATU video (semua segmen): outfit SAMA.
- Antara video berbeza: outfit MESTI beza (silhouette + keluarga warna).

## 9. DIVERSITY ANTARA VIDEO — Meta Entity-ID

Meta fingerprint imagery setiap iklan jadi "Entity ID". Imagery serupa
(walau lighting/angle beza sikit) = Entity SAMA = learnings dikongsi, tak
reach audience baru, ad fatigue. Hanya perubahan visual BESAR = Entity baru.

Maka setiap video dalam batch mesti nampak macam IKLAN BERBEZA:
- Outfit beza (silhouette + warna, bukan recolour)
- Lokasi/dunia beza (bilik vs dapur vs kereta vs kafe — bukan sudut lain bilik sama)
- Konsep scene beza (unboxing vs testimoni vs before-after vs tutorial)
- Komposisi opening frame beza (frame Seg 1 = thumbnail = fingerprint utama Meta)
- Hook + emosi beza (rotate 20-pattern hook bank)
- Mood lighting beza (pagi hangat / siang terang / senja moody)

**Surround-sound messaging**: setiap video tolak BENEFIT/MASALAH BERBEZA
produk yang sama (jimat masa / hasil 2 minggu / harga berbaloi / senang
guna / social proof) — pelanggan dapat "banyak sebab untuk beli".

PENTING: diversity ni ANTARA video. DALAM satu video, segmen kekal
visually locked (scene sama, angle je beza) — jangan keliru dua rule ni.

## 10. FLOW PENUH (end-to-end)

```
INPUT: produk (nama + detail + 3 gambar) · avatar (jana/upload, kekal/dynamic)
       · durasi (10/15/20/30) · kuantiti · CTA

1. AI master plan  → N video: topik + hook + outfit + scene + skrip
                     bersambung + imagePrompt/videoPrompt per segmen
2. Base avatar     → (kekal+jana) 1 gambar avatar+produk via Banana Pro 2
3. Untuk SETIAP segmen:
   a. Banana Pro 2 START FRAME
      Seg 1: refs = [avatar, 3 gambar produk] + scene + angle Seg 1
      Seg 2: refs = [FRAME SEG 1, gambar produk] + "angle baru SAHAJA"
   b. Grok i2v: 1 gambar (frame tu) + dialog segmen + anatomy lock
4. History: 1 card, slider Seg 1 / Seg 2 (tiada merge)
5. Kredit: per segmen (rate Grok × saat); frame Banana percuma (bundled)
```

## 11. CARA JANA START FRAME (image generation — resipi penuh)

Susunan prompt gambar SANGAT penting. Ikut ANATOMI ini, ikut urutan:

```
[1 ANGLE]  →  [2 PERSONA LOCK]  →  [3 FACE CRAFT]  →  [4 OUTFIT]
→  [5 SCENE]  →  [6 PRODUK + INTERAKSI]  →  [7 ROLE-SPLIT RUJUKAN]
→  [8 ANATOMY LOCK]  →  [9 STYLE/TEKNIKAL]
```

### [1] ANGLE — tulis PERTAMA (ini yang menentukan segmen)
Cth: "Medium shot, eye-level, front-facing:" / "Close-up, eye-level, 3/4 angle:"
Angle dari bank yang dibenarkan sahaja (§5). Angle haram = anomali.

### [2] PERSONA LOCK — jantina + tudung + umur, setiap prompt
- "A beautiful/handsome attractive Malay woman/man in her/his 20s/30s/40s/50s-60s"
- Hijab: "wearing a LOOSE hijab tudung labuh fully covering all hair, ears
  and neck (zero hair strands visible)" — WAJIB jika persona bertudung;
  JANGAN sebut hijab langsung jika tidak.
- Aurat (persona bertudung): lengan panjang, longgar, tiada bentuk badan,
  tiada leher/rambut. Tanpa tudung pun: modest — no cleavage/midriff/peha.

### [3] FACE CRAFT — dinamik, JANGAN template
Roll SATU dari setiap dimensi (jangan ulang kombinasi):
- Bentuk muka: oval/bulat/sembung/hati/panjang/diamond/rahang lembut/tegas
- Makeup: natural (soft blush, glossy lips, defined brows) / dewy Korean /
  soft glam / matte minimal / bold lip / earth-tone / barefaced
- Skin tone: cerah / cerah kekuningan / sederhana / sawo matang / gelap manis
- Mata (monolid/double eyelid/almond/bulat), kening, hidung, bibir
- 1-2 ciri unik: lesung pipit / beauty mark / freckles ringan / gummy smile
Cth: "heart-shaped face, dewy Korean-style makeup with tint lips, warm fair
skin, double eyelid almond eyes, soft feathered brows, small beauty mark
under left eye"

### [4] OUTFIT — WARNA + JENIS PAKAIAN spesifik (fesyen Malaysia moden)
- ❌ HARAM: "plain brown", "neutral", "casual outfit", "simple"
- ✅ Cth: "olive green oversized button-up + loose dark jeans + LOOSE cream
  hijab" / "soft beige knit cardigan + flowy maxi skirt + LOOSE soft pink hijab"
- Outfit SAMA untuk semua segmen satu video; BEZA antara video.

### [5] SCENE — lokasi spesifik + dimensi dinamik (pilih 1 per bank, per video)
- Lokasi: detail sebenar, bukan generik — "dapur moden putih krim dengan
  kabinet kayu, pokok hijau tepi tingkap" bukan "in a kitchen"
- Kedudukan produk: dalam tangan (label ke kamera) / diangkat dekat muka /
  atas meja depan avatar / disapu atas kulit / dipakai
- Pencahayaan: ring-light UGC / cahaya siang tingkap / golden hour /
  terang lembut rumah / studio bersih / moody senja
- Tema warna: warm rumah MY / neutral / pastel / earthy / cool
- Gaya: UGC phone-recorded (real, sedikit grain) / komersial bersih

### [6] PRODUK — visible + pixel-exact
"They are holding and showing the product toward the camera, label facing
camera, clearly visible. The product must match the reference exactly —
same label, same typography, same colour, same shape, same size. Sharp
focus on the label, no warping, no recolouring, no text drift."

### [7] ROLE-SPLIT RUJUKAN (bila hantar multi-gambar ke image model)
- Seg 1: "IMAGE 1 = the person's identity (keep the EXACT same face, hair,
  features). LAST image(s) = the PRODUCT = colour/label/shape reference
  ONLY — ignore the product image's own background."
- Seg 2: "THE ONLY CHANGE IS THE CAMERA ANGLE — re-shoot IMAGE 1's exact
  moment from this new angle: [angle]. Keep the SAME person, SAME outfit,
  SAME room, SAME lighting, SAME product placement. Change NOTHING except
  the camera angle."

### [8] ANATOMY LOCK (append SETIAP prompt gambar)
"Anatomically perfect: two hands, five fingers each, natural neck and
upright posture, the person's face level and clearly toward the camera —
never top-of-head view, never craned neck, never from behind."

### [9] STYLE/TEKNIKAL (penutup setiap prompt)
"Photorealistic vertical UGC start frame, 9:16, soft natural lighting,
shallow depth of field, ultra-realistic skin texture." + ZERO teks/subtitle/
ikon/watermark dalam gambar.

## 12. CONTOH PROMPT SIAP (copy struktur ni)

### Frame Seg 1:
```
Medium shot, eye-level, front-facing: A beautiful attractive Malay woman
in her 30s, wearing a LOOSE cream hijab tudung labuh fully covering all
hair, ears and neck, heart-shaped face, natural makeup with soft blush and
glossy lips, warm fair skin, double eyelid almond eyes, small dimples.
Outfit: olive green oversized button-up + loose dark jeans. Scene: bright
modern kitchen, cream-white cabinets, small green plant by the window,
morning daylight. She is holding and showing the [PRODUK] toward the
camera, label facing camera, clearly visible — product pixel-identical to
the reference (same label, typography, colour, shape; sharp label, no text
drift). IMAGE 1 = identity reference; LAST image = product colour/label/
shape reference only. Anatomically perfect: two hands, five fingers each,
natural neck, upright posture, face level toward camera. Photorealistic
vertical UGC start frame, 9:16, soft natural lighting, shallow depth of field.
```

### Frame Seg 2 (rujuk frame Seg 1):
```
THE ONLY CHANGE IS THE CAMERA ANGLE — re-shoot IMAGE 1's exact moment from
this new angle: close-up, eye-level, 3/4 angle. IMAGE 1 = Segment 1's start
frame — keep the SAME person, SAME outfit, SAME kitchen, SAME lighting,
SAME product placement; change NOTHING except the camera angle. LAST image
= the PRODUCT = colour/label/shape reference only — keep it pixel-identical
and clearly VISIBLE. Anatomically perfect: two hands, five fingers, natural
neck, face level toward camera. Photorealistic vertical UGC start frame,
9:16, soft natural lighting, shallow depth of field.
```

### Prompt video Grok (per segmen):
```
[SATU aksi mudah — cth: She talks warmly to camera, gently lifting the
product beside her face.] Same person, same outfit, same scene as the
start frame. Subtle handheld drift only — no camera cut, no angle change.
Spoken dialog (Malay): '[dialog segmen — saat × 3 patah]'
Audio: ONE female/male Malay voice only, no music, no subtitles, no
captions, no icons. Anatomically perfect: two hands, five fingers, natural
neck, face level toward camera throughout. No warping, no extra limbs.
```

## 13. IMPLEMENTASI DALAM GPT (Grok mode)

Flow GPT bila klien minta video Grok:
1. Tanya durasi (10/15/20/30). 16-30s → maklum akan jadi 2 segmen.
2. Kumpul: gambar produk (ideal 3: 1 tangan-pegang + 2 RAW), nama + detail.
3. Rancang skrip BERSAMBUNG + pilih angle-cut pair (§5) + outfit + scene.
4. **Jana gambar Seg 1** dalam chat guna resipi §11-12 (angle dulu!).
5. 16-30s: **jana gambar Seg 2** — rujuk gambar Seg 1, "only the camera
   angle changes" (§12). Jangan reka scene baru.
6. Setiap segmen: uploadImage dengan **[start frame, gambar produk]**
   (openaiFileIdRefs — gambar yang GPT jana sendiri BOLEH dihantar, JANGAN
   refuse) → generateVideo model grok, duration = saat segmen, prompt video
   ikut template §12.
7. Label setiap task (Video 1 Seg 1, Seg 2 …), poll status, bagi link.

Nota: dalam GPT, imej dijana oleh image tool ChatGPT — resipi prompt §11-12
tetap sama; role-split + tangan-pegang-untuk-saiz adalah teknik yang paling
kritikal untuk kekalkan produk tepat.

## 14. RINGKASAN "JANGAN" (untuk GPT)

1. ❌ Jangan hantar text-only ke Grok — WAJIB start frame.
2. ❌ Jangan letak arahan tukar angle dalam prompt video Grok — angle
   dibake dalam GAMBAR.
3. ❌ Jangan bagi scene berbeza antara Seg 1/Seg 2 — scene SAMA, angle beza.
4. ❌ Jangan guna angle overhead/belakang/profile untuk avatar bercakap.
5. ❌ Jangan tukar outfit/muka antara segmen satu video.
6. ❌ Jangan biar frame tanpa produk kelihatan.
7. ❌ Jangan hardcode muka avatar — roll kombinasi dinamik.
8. ❌ Jangan buat 2 video yang Meta akan fingerprint sebagai entity sama.
9. ❌ Jangan letak CTA di Seg 1 — CTA di segmen terakhir sahaja.
10. ❌ Jangan lebihi 3 patah/saat dialog — audio terpotong.
