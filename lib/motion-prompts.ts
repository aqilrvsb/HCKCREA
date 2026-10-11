// Motion tab — prompt suggestion chips + Malaysian TikTok Shop ("beg kuning")
// playbook for the AI director.
//
// - MOTION_EDIT_PRESETS  → chips under the prompt box in "Edit Video" mode
//   (client's own talking-head video; director adds hook, stickers, B-roll,
//   fact cards, zooms, captions, SFX).
// - MOTION_AD_PRESETS    → chips under the prompt box in "Buat Iklan" mode
//   (voiced motion-graphics ad generated from a product brief).
// - MOTION_MY_TIKTOK_GUIDE → injected into the director LLM system prompt.
//
// Every preset is phrased so the AI never invents prices, discounts, ratings,
// sales counts, reviews, claims or scarcity — it may only use what is said in
// the video or written in the client's brief.
//
// Wording/insights also reused from the in-repo Malaysian UGC knowledge:
// lib/skills/ugc/ctas/* (tap-beg-kuning, urgency, scarcity, demo-tap,
// comment-trigger, if-then), lib/skills/ugc/cultural/code-switch.ts,
// lib/skills/ugc/scenes/* (unboxing, before-after-skin, tutorial-how-to,
// comment-response, foodie-reaction, office-vitamin),
// lib/auto-content-frameworks.ts (SHOP_CTA_VARIATIONS), lib/sop-content.ts.
// Research done 2026-10-12.

/*
Sources:
https://ppc.land/tiktok-shops-shoppable-video-content-guide-tells-creators-what-actually-works/
https://ads.tiktok.com/help/article/considerations-when-launching-your-tiktok-shop-journey
https://newsroom.tiktok.com/tiktok-shop-records-over-100-million-product-searches-daily-in-malaysia?lang=en-MY
https://says.com/my/seismik/ikuti-cara-paling-mudah-ini-untuk-anda-jana-pendapatan-lebih-banyak-dengan-tiktok-shop
https://says.com/my/lifestyle/tiktok-shop-11-11-mega-sale
https://says.com/my/seismik/tiktok-shop-12-12-kembali-diskaun-luar-biasa-free-shipping-tanpa-had-giveaway-sampai-50
https://www.bernama.com/en/news.php?id=2501327
https://says.com/my/lifestyle/tiktokshop-ramadan-raya-2026
https://www.malaymail.com/news/money/2026/04/09/tiktok-shop-posts-over-130pc-sales-growth-during-ramadan-aidilfitri/215615
https://says.com/my/lifestyle/khairul-aming-12-hour-livestream-rembayung
https://www.bigseller.pro/blog/articleDetails/4887/tiktok-shop-jomlokal-tips.htm
https://www.bigseller.pro/blog/articleDetails/4709/tiktok-shop-health-wellness-product.htm
https://malaymail.com/news/life/2025/09/03/tiktok-shops-continuous-investment-in-safety-fuels-sustainable-growth-for-malaysian-msmes/189869
https://www.nst.com.my/amp/news/nation/2026/02/1375100/moh-raids-30-sites-over-illegal-aesthetic-services
https://hashmeta.com/my/posts/tiktok-kol-strategy-malaysia-2026-campaign-guide
https://contentgrip.com/tiktok-shop-strategy-southeast-asia/
https://involve.asia/blog/top-selling-tiktok-shop-affiliate-products-malaysia/
https://ecomobi.com/ms/7-tips-untuk-kejayaan-pemasaran-affiliate-tiktok
https://www.netinfluencer.com/tiktok-identifies-three-major-behavioral-shifts-for-2026-in-annual-trend-forecast/
https://www.silvermouse.com.my/blog/tiktok-shop-in-malaysia-3-things-you-need-to-know/
https://fintechnews.my/46979/fintech-lending-malaysia/tiktok-paylater/
*/

export type MotionPreset = {
  id: string; // kebab-case, unique
  label: string; // chip text, ≤ 22 chars, Malay/Manglish, may start with one emoji
  prompt: string; // full instruction inserted into the prompt box
  tags: string[];
};

// ─── Edit Video (client's own talking-head TikTok video) ────────────────────

export const MOTION_EDIT_PRESETS: MotionPreset[] = [
  {
    id: "jualan-beg-kuning",
    label: "🛒 Jualan beg kuning",
    prompt:
      "Jadikan video jualan beg kuning yang padu: hook headline 3 saat pertama ikut masalah atau produk yang disebut, punch-in zoom setiap kali produk ditunjuk, price tag bila harga disebut (guna harga dalam video sahaja) dan tick checklist untuk setiap kelebihan yang disebut. Tutup 3 saat terakhir dengan satu CTA sahaja: 'Tekan beg kuning sekarang' + arrow ke bawah.",
    tags: ["jualan", "beg-kuning", "hard-sell", "harga"],
  },
  {
    id: "soft-sell-cerita",
    label: "📖 Soft sell / cerita",
    prompt:
      "Gaya soft sell storytelling: biarkan cerita dalam video mengalir, kurangkan sticker — bigword hanya pada ayat paling emosi dan caption yang bersih. Produk muncul secara natural dengan punch-in perlahan bila ditunjuk, tiada price slam, dan tutup dengan CTA lembut 'Kalau nak cuba, link ada kat beg kuning'.",
    tags: ["soft-sell", "storytelling", "beg-kuning"],
  },
  {
    id: "review-jujur",
    label: "⭐ Review jujur",
    prompt:
      "Video review jujur: hook headline macam 'Jangan beli sebelum tengok ni' atau 'Review jujur lepas guna', tick hijau untuk kelebihan dan callout neutral untuk kekurangan yang disebut dalam video, serta stamp verdict pada ayat kesimpulan. Jangan tambah bintang rating atau claim yang tak disebut dalam video; akhir dengan CTA 'Link kat beg kuning bawah ni'.",
    tags: ["review", "jujur", "trust", "beg-kuning"],
  },
  {
    id: "unboxing-parcel",
    label: "📦 Unboxing parcel",
    prompt:
      "Video unboxing: hook 'Parcel dah sampai!' dengan emoji 📦, SFX whoosh/pop setiap kali bungkusan dibuka, dan punch-in zoom pada first look produk serta packaging. Bigword untuk reaksi first impression (contoh 'Pergh!'), callout untuk isi kotak yang disebut, dan akhir dengan CTA 'Tekan beg kuning' + arrow.",
    tags: ["unboxing", "parcel", "first-impression", "beg-kuning"],
  },
  {
    id: "before-after",
    label: "✨ Before / after",
    prompt:
      "Highlight before/after: label besar 'BEFORE' dan 'AFTER' tepat pada momen yang ditunjuk dalam video, flash transisi di antara dua keadaan dan punch-in zoom pada hasil. Guna hanya hasil yang betul-betul nampak — jangan besarkan claim, tiada claim perubatan atau berat badan, tambah teks kecil 'Pengalaman peribadi' untuk hasil kulit/kesihatan; tutup dengan CTA 'Nak cuba? Tekan beg kuning'.",
    tags: ["before-after", "hasil", "demo", "beg-kuning"],
  },
  {
    id: "tutorial-cara-guna",
    label: "📝 Tutorial cara guna",
    prompt:
      "Jadikan tutorial cara guna: badge nombor 'STEP 1 / 2 / 3' bila setiap langkah disebut, punch-in zoom pada tangan dan produk masa demo, dan callout untuk tip penting (contoh 'Jangan skip step ni'). Caption bersih dan senang ikut, akhir dengan CTA 'Senang je kan? Link kat beg kuning'.",
    tags: ["tutorial", "cara-guna", "demo", "edukasi"],
  },
  {
    id: "harga-promo",
    label: "💸 Harga & promo",
    prompt:
      "Fokus harga & promo: price reveal penuh (harga asal dicoret → harga baru slam + bunyi ka-ching) hanya guna harga yang disebut dalam video atau yang client bagi. Jika ada promo 11.11 / 12.12 / Payday / voucher / free shipping yang disebut, tambah banner kempen — kalau tak disebut, jangan reka promo; CTA akhir 'Checkout sekarang kat beg kuning'.",
    tags: ["harga", "promo", "kempen", "11.11", "12.12", "payday"],
  },
  {
    id: "murah-vs-mahal",
    label: "🆚 Murah vs mahal",
    prompt:
      "Format comparison murah vs mahal: label 'MURAH' vs 'MAHAL' (atau 'Biasa' vs 'Ni') bila perbandingan dibuat, price tag untuk setiap harga yang disebut, tick hijau pada kelebihan produk dan pangkah merah pada kekurangan yang disebut. Jangan sebut atau tunjuk logo jenama pesaing dan jangan reka beza harga; tutup dengan stamp verdict yang disebut dalam video + CTA beg kuning.",
    tags: ["comparison", "murah-vs-mahal", "harga", "berbaloi"],
  },
  {
    id: "pov-relatable",
    label: "🤳 POV relatable",
    prompt:
      "Gaya POV relatable: hook headline 'POV: ...' ikut situasi yang diceritakan, emoji reaksi pada momen relatable dan callout speech bubble untuk 'suara hati' penonton. Pace laju dengan perubahan visual setiap 2–3 saat, produk masuk sebagai penyelesaian dengan punch-in, akhir dengan CTA 'Korang pun macam ni? Tekan beg kuning'.",
    tags: ["pov", "relatable", "hook", "beg-kuning"],
  },
  {
    id: "kelakar-meme",
    label: "😂 Kelakar / meme",
    prompt:
      "Tambah meme energy: emoji besar 😂😭 pada punchline, bigword kinetic pada ayat kelakar, screen shake + SFX lawak dan zoom dramatik pada momen lucu. Jangan biar lawak tenggelamkan produk — product close-up tetap jelas sekurang-kurangnya sekali, dan tutup dengan CTA beg kuning yang santai.",
    tags: ["kelakar", "meme", "hiburan", "beg-kuning"],
  },
  {
    id: "testimoni-sebenar",
    label: "💬 Testimoni sebenar",
    prompt:
      "Highlight testimoni: kad quote untuk ulasan pelanggan yang dibaca atau ditunjuk dalam video (petik ayat sebenar sahaja), dan bintang rating hanya jika nombornya disebut. Jangan reka review, nama pelanggan, jumlah terjual atau rating; akhir dengan CTA 'Tengok sendiri review kat beg kuning'.",
    tags: ["testimoni", "social-proof", "trust", "beg-kuning"],
  },
  {
    id: "stok-promo-terhad",
    label: "⏰ Stok/promo terhad",
    prompt:
      "Tambah urgency HANYA berdasarkan apa yang disebut dalam video: kalau disebut stok tinggal sikit atau promo tamat pada masa tertentu, buat banner merah + stamp 'STOK TERHAD' atau 'PROMO TAMAT ...' ikut ayat sebenar. Kalau tak disebut, jangan reka scarcity, countdown atau deadline — guna CTA biasa 'Tekan beg kuning sekarang'.",
    tags: ["urgency", "scarcity", "promo", "beg-kuning"],
  },
  {
    id: "live-highlight",
    label: "🔴 Gaya live highlight",
    prompt:
      "Edit macam highlight TikTok LIVE: badge kecil 'LIVE HIGHLIGHT' di penjuru, caption besar bertenaga, price tag pop-up + SFX ka-ching setiap kali harga disebut, dan bigword 'Flash deal!' atau 'Last call!' hanya jika disebut. Pace laju, akhir dengan CTA 'Tekan beg kuning, checkout sekarang'.",
    tags: ["live", "highlight", "harga", "beg-kuning"],
  },
  {
    id: "barang-viral",
    label: "🔥 Barang viral FYP",
    prompt:
      "Angle barang viral (guna perkataan 'viral' hanya jika disebut dalam video): hook headline 'Barang viral ni berbaloi ke?', emoji 🔥 dan reaction punch-in bila produk dicuba. Tick kelebihan yang disebut, stamp verdict pada kesimpulan, CTA akhir 'Nak cuba sendiri? Beg kuning bawah ni'.",
    tags: ["viral", "fyp", "trending", "beg-kuning"],
  },
  {
    id: "fakta-edukasi",
    label: "🧠 Fakta & edukasi",
    prompt:
      "Video edukasi/fakta: bila bahan, istilah atau isu umum disebut, tambah fact card Google (fakta umum sahaja, wajib ada sumber) dan B-roll gambar berkaitan. Jangan buat fact card tentang khasiat perubatan produk; caption kemas, nada pakar tapi santai, akhir dengan CTA 'Info penuh kat beg kuning'.",
    tags: ["edukasi", "fakta", "google", "broll"],
  },
  {
    id: "jawab-komen",
    label: "❓ Jawab komen",
    prompt:
      "Format reply komen: sticker gaya komen TikTok di bahagian atas dengan soalan/keraguan yang dibaca dalam video (tulis tepat macam disebut), kemudian tick dan punch-in pada bukti yang ditunjuk (label, tekstur, cara guna). Nada tenang dan tak defensif, akhir dengan CTA 'Dah yakin? Tekan beg kuning'.",
    tags: ["komen", "objection", "trust", "beg-kuning"],
  },
];

// ─── Buat Iklan (voiced motion-graphics ad from a product brief) ────────────

export const MOTION_AD_PRESETS: MotionPreset[] = [
  {
    id: "iklan-beg-kuning",
    label: "🛒 Iklan beg kuning",
    prompt:
      "Iklan jualan beg kuning: hook 3 saat pertama tunjuk masalah utama pembeli + nama produk, kemudian 3 kelebihan dari brief sebagai checklist bertick dan price tag guna harga dalam brief sahaja. Voiceover santai Bahasa Melayu Malaysia, CTA end card 'Tekan beg kuning sekarang' + arrow dalam 3 saat terakhir.",
    tags: ["jualan", "beg-kuning", "hard-sell", "harga"],
  },
  {
    id: "price-reveal",
    label: "💸 Price reveal padu",
    prompt:
      "Fokus price reveal: harga asal dicoret → harga promo slam + kaunter + ka-ching, hanya jika brief ada kedua-dua harga; kalau ada satu harga je, tunjuk price tag biasa tanpa diskaun. Badge free shipping / COD / voucher hanya jika disebut dalam brief, CTA 'Checkout sekarang kat beg kuning'.",
    tags: ["harga", "promo", "diskaun", "beg-kuning"],
  },
  {
    id: "mega-sale",
    label: "📅 Mega sale & Payday",
    prompt:
      "Tema mega sale (11.11, 12.12, Payday atau sale lain — ikut yang client tulis dalam brief/prompt): banner kempen bertenaga, confetti, bigword 'SALE' dan price reveal guna harga promo dari brief. Jangan letak tarikh, peratus diskaun, voucher atau free shipping yang tiada dalam brief; CTA 'Jom cop sebelum sale habis' hanya jika tarikh tamat diberi, kalau tak guna 'Tekan beg kuning sekarang'.",
    tags: ["kempen", "11.11", "12.12", "payday", "sale"],
  },
  {
    id: "ramadan-raya",
    label: "🌙 Ramadan & Raya",
    prompt:
      "Mood Ramadan/Raya: warna hijau-emas, emoji ketupat/pelita secukupnya, voiceover mesra dengan angle persiapan raya atau idea hadiah untuk keluarga. Promo raya, status halal atau free shipping hanya jika ada dalam brief; CTA 'Siap untuk raya — tekan beg kuning'.",
    tags: ["ramadan", "raya", "musim", "hadiah"],
  },
  {
    id: "masalah-solusi",
    label: "😩 Masalah → solusi",
    prompt:
      "Struktur masalah → solusi (PAS): buka dengan soalan pain point dari brief (contoh 'Penat tak...?') dalam teks merah, agitate sekejap, kemudian produk masuk sebagai solusi dengan flash + teks hijau. Guna hanya masalah dan manfaat yang ada dalam brief, tutup dengan CTA 'Tekan beg kuning sekarang'.",
    tags: ["pas", "masalah", "solusi", "beg-kuning"],
  },
  {
    id: "tiga-sebab",
    label: "✅ 3 sebab kena ada",
    prompt:
      "Format listicle '3 sebab korang kena ada [produk]': setiap sebab dapat nombor besar + bigword + tick, satu sebab setiap 3–4 saat, semua sebab diambil dari USP dalam brief. Akhir dengan ringkasan 3 tick dan CTA 'Tekan beg kuning sekarang'.",
    tags: ["listicle", "usp", "kelebihan", "beg-kuning"],
  },
  {
    id: "vs-cara-biasa",
    label: "🆚 Ni vs cara biasa",
    prompt:
      "Comparison 'cara biasa vs [produk]': split screen merah (pangkah) vs hijau (tick), bandingkan dengan cara lama secara umum — jangan sebut, tunjuk atau rendahkan jenama pesaing. Semua kelebihan mesti dari brief, tiada nombor atau peratus yang direka; CTA beg kuning di hujung.",
    tags: ["comparison", "kelebihan", "beg-kuning"],
  },
  {
    id: "fakta-produk",
    label: "🧠 Fakta produk",
    prompt:
      "Iklan edukasi: terangkan bahan atau ciri utama dari brief dengan fact card ringkas (maksimum 12 patah perkataan) dan ikon, nada pakar tapi santai. Jangan tambah claim perubatan, peratus keberkesanan atau sijil (KKM/halal) yang tak tertulis dalam brief; CTA 'Info penuh kat beg kuning'.",
    tags: ["edukasi", "fakta", "bahan", "trust"],
  },
  {
    id: "lawak-relatable",
    label: "😂 Lawak relatable",
    prompt:
      "Iklan kelakar relatable: buka dengan situasi harian Malaysia yang lucu (contoh jem, panas terik, lupa barang) yang berkait dengan masalah dalam brief, emoji 😂 besar, screen shake dan SFX lawak. Produk tetap jadi hero di tengah dan akhir, tutup dengan CTA santai 'Tak payah susah-susah, tekan beg kuning'.",
    tags: ["kelakar", "relatable", "hiburan", "beg-kuning"],
  },
  {
    id: "hype-gempak",
    label: "⚡ Hype gempak FYP",
    prompt:
      "Gaya hype gempak: perubahan visual setiap 2 saat, bigword kinetic, flash, particle burst, SFX whoosh dan muzik upbeat. Teks pendek (maksimum 4 patah perkataan setiap sticker), jangan tulis 'viral' atau 'best seller' melainkan brief kata begitu; CTA end card beg kuning.",
    tags: ["hype", "gempak", "fyp", "beg-kuning"],
  },
  {
    id: "soft-sell-aesthetic",
    label: "🤍 Soft sell aesthetic",
    prompt:
      "Soft sell aesthetic: gaya clean, transisi perlahan, palet lembut dan voiceover tenang macam kawan recommend, sticker minimum. Fokus pada rasa dan gaya hidup guna produk, harga muncul sekali je (dari brief), CTA lembut 'Link ada kat beg kuning'.",
    tags: ["soft-sell", "aesthetic", "lifestyle"],
  },
  {
    id: "bukti-sosial",
    label: "⭐ Bukti sosial",
    prompt:
      "Tonjolkan bukti sosial HANYA jika brief ada data sebenar (rating, jumlah terjual, review pelanggan): bintang rating, kaunter terjual dan kad quote review guna angka dan ayat tepat dari brief. Jika tiada data, guna angle lain dan jangan reka angka; CTA 'Tengok review kat beg kuning'.",
    tags: ["social-proof", "testimoni", "rating", "trust"],
  },
  {
    id: "cod-free-shipping",
    label: "🚚 COD & free shipping",
    prompt:
      "Tekankan kemudahan beli: badge COD, free shipping, PayLater atau penghantaran cepat — hanya yang disebut dalam brief. Tunjuk langkah mudah 'Tekan beg kuning → checkout → sampai rumah' dengan ikon animasi, CTA 'Tekan beg kuning, senang je'.",
    tags: ["cod", "free-shipping", "checkout", "beg-kuning"],
  },
];

// ─── Director playbook (system-prompt injection) ────────────────────────────

export const MOTION_MY_TIKTOK_GUIDE = `MALAYSIA TIKTOK SHOP ("BEG KUNING") PLAYBOOK — follow it when planning overlays, on-screen copy and CTA.
Audience: Malaysian TikTok Shop viewers who buy straight from the video through the yellow bag ("beg kuning") product link. Every overlay should move them toward that tap.
Write on-screen text in Bahasa Melayu Malaysia, santai. Manglish and mid-sentence code-switching are fine (korang, aku/saya, gila, padu, confirm, berbaloi, mantap, pergh, je, lah, kan). Match the speaker's own language mix.
Never use Indonesian wording ("kamu", "banget", "gratis ongkir", "bisa", "gimana", "keren", "aja"). Say "beg kuning", not "keranjang kuning", unless the speaker says it.
Never use dead or corporate lines ("Hi guys harini aku nak review", "game changer", "like, share & subscribe").
The first 3 s decide everything: show a hook headline (max 6 words) from frame 1, tied to the product. Never use a hook unrelated to the product.
Hook patterns that work in Malaysia: pain question ("Penat tak...?", "Korang pernah tak...?"), "Jangan beli X sebelum tengok ni" (only if the video gives an honest verdict), "POV: ...", result-first before/after, price/value hook ("RM__ je?"), "Review jujur lepas __ hari", reply-to-comment, "Barang viral ni berbaloi ke?" (only if the speaker calls it viral).
If the product name or price is known (spoken anywhere in the video or given in the brief), you may tease it in the hook: product + price early lifts conversion.
Keep a visual change every 2-4 s (zoom, sticker, B-roll, cut). In videos longer than about 20 s add one mid-video re-hook banner.
Many viewers watch muted: captions and stickers must carry the message on their own.
Text length: hook max 6 words; stickers, price tags and stamps max 4 words; bigword 1-2 words; fact card max 12 words plus "Sumber: domain"; caption lines max 5 words.
Keyword colours: price = yellow, benefit = green, pain/problem = red, brand = accent. Max one emoji per sticker.
Emphasise the conversion moments: (1) price reveal - strike old price then slam new price only when BOTH prices are spoken or given; (2) product close-up - punch-in whenever the product is held, shown or used; (3) benefits - tick a checklist item as each benefit is said; (4) proof - before/after or demo result at the exact moment it is shown; (5) CTA in the final 3 s.
CTA: exactly one, in the final 3 s, with an arrow pointing down toward the product link. Use phrases like "Tekan beg kuning sekarang", "Link kat beg kuning bawah ni", "Checkout sekarang", "Jom cop kat beg kuning", "Beg kuning bawah, tap je". If the speaker says their own CTA, reuse their words.
Never add "link in bio" or a second CTA (follow/like/share) after the beg kuning CTA.
Add "COD boleh", "free shipping", "PayLater" or voucher badges only if the speaker or brief says so.
Campaign vocabulary - use only when the speaker, brief or client prompt mentions that campaign: 11.11 Mega Sale, 12.12 Jualan Akhir Tahun, Payday Sale, 9.9, Ramadan/Raya, Merdeka, CNY, flash sale, Harga Hangat, harga runtuh, baucar berganda, stackable voucher, free shipping tanpa had, Buy 1 Free 1, LIVE giveaway, "siapa cepat dia dapat".
Never put a campaign date, discount %, voucher amount, free gift or "harga hari ni je" on screen unless it was said or given.
Use urgency or scarcity ("stok terhad", "promo tamat malam ni") only when the speaker or brief states it. Never invent a deadline, countdown or stock level.
Use social proof (stars, "10k terjual", review quotes) only with the exact numbers and words from the speech or brief. Never fabricate reviews, customer names, ratings or sales counts.
TikTok Shop's content policy bans misleading or false content and holds affiliate creators to the same standard. When unsure whether a claim is supported, leave it out.
Health, beauty, supplement and slimming products: no medical or therapeutic claims (rawat, sembuh, ubat, cure, "hilang terus"), no guaranteed results, no weight-loss or body-shape before/after, no "Ozempic"/"GLP-1" comparisons. Malaysian health ads need MAB/KKLIU approval, so never add a claim the seller did not make.
When the speaker shares a personal result, keep it personal ("Pengalaman saya") - never turn it into a universal promise.
Show halal status, KKM/MAL numbers, awards or "original/authentic" only if the seller states it.
Comparisons: compare with "cara biasa" or a generic alternative. Never name, show or mock a competitor brand.
Fact cards: general, verifiable facts with a source domain only. Never write a fact card claiming the product's own medical efficacy.
Never present AI-made visuals as real customer footage or as a real testimonial.
Never cover the speaker's face, the product, or any #iklan / #ad / paid-partnership disclosure. Keep text out of the bottom ~20% (TikTok caption + product link) and the right-edge button column.
Tone: like a kawan recommending, not a TV ad. Gempak/hype for hard sell, promo and live-highlight; calm and clean for soft sell, review and tutorial.
Buat Iklan: land the product, its main benefit and the price (if given) within the first half, keep the ad tight (product demos under about 30 s convert best) and use only facts from the brief.`;
