// SOP (Standard Operating Procedure) content for the dashboard pages.
// One entry per page-key. The SopButton picks the matching entry based
// on the active dashboard view / tab and renders SopModal with it.
//
// Tone: casual Malaysian-Malay mix ("korang", "aku", "ni", "tu",
// "memang", "gila") with English tech terms left in English ("AI
// agent", "frame", "history", "ingredient mode", "veo"). Matches the
// rest of the app's voice.
//
// Screenshots live under /public/sop/<page-key>/<file>.png. Captured
// via Playwright at desktop width (1280x900) so the UI is spacious
// enough for tutorial use; the modal scales them responsively on
// mobile. If a screenshot is missing the modal hides the broken image
// gracefully and the SOP still works.

export type SopStep = {
  title: string;
  image?: string;        // public path, e.g. "/sop/ugc/step-1.png"
  imageAlt?: string;
  description: string;   // 1–4 sentences in casual Malay
  tip?: string;          // optional pro-tip line
};

export type SopSection = {
  heading: string;       // section divider, e.g. "Cara guna AI Agent UGC"
  steps: SopStep[];
};

export type SopPage = {
  pageKey: string;       // matches activeTab / view.kind values
  title: string;         // user-facing title in Malay
  subtitle?: string;     // one-line tagline
  intro: string;         // "Apa ini tab?" paragraph
  whenToUse: string;     // when does this tab make sense?
  sections: SopSection[];
  closing?: string;      // optional final note
};

export const SOP_CONTENT: Record<string, SopPage> = {
  // ─────────────────────────────────────────────────────────────────
  // IMAGE tab — Banana Pro / GPT Image / Imagen
  // ─────────────────────────────────────────────────────────────────
  image: {
    pageKey: "image",
    title: "Tab Image — Generate Image AI",
    subtitle: "Banana Pro · GPT Image 2 · Imagen 4",
    intro:
      "Tab Image untuk korang generate gambar avatar / produk / scene custom guna AI. Boleh combine character image + product image + prompt → AI buat gambar baru yang gabung semua tu. Output 9:16 paling sesuai untuk TikTok.",
    whenToUse:
      "Bila korang nak buat gambar avatar dulu sebelum generate video. Atau bila nak gambar product placement yang tak ada photographer. Atau bila nak banyak variasi muka avatar untuk pakai dalam UGC tab nanti.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Form overview",
            image: "/sop/image/overview.png",
            imageAlt: "Image tab full form: Image Generator, Character Reference, Product Reference",
            description:
              "Tiga card utama: Image Generator (pilih Model + Mode), Character Reference (drop muka avatar), Product Reference (drop gambar produk). Bawah lagi ada Prompt & Settings dengan tab Avatar / Product / Sales.",
          },
          {
            title: "Step 2 — Pilih Model",
            description:
              "Banana Pro (default — paling natural untuk muka Malaysia). GPT Image 2 (kreatif, scene aesthetic). Imagen 4 (Google, paling realistic tapi mahal sikit). Mula dengan Banana Pro.",
            tip:
              "Untuk muka avatar yang konsisten merentasi banyak gambar — Banana Pro paling stable.",
          },
          {
            title: "Step 3 — Upload Character Reference",
            description:
              "Drag muka avatar yang korang nak guna (selfie clear). AI akan kekalkan muka tu dalam SEMUA variation yang korang generate. Boleh pakai 'From History' kalau dah pernah generate.",
            tip:
              "1 muka clear je — kalau ramai orang dalam gambar reference, AI akan confused.",
          },
          {
            title: "Step 4 — Upload Product Reference (kalau ada)",
            description:
              "Drag gambar produk korang (packaging, label clear). AI akan kekalkan produk tu pixel-perfect dalam scene. Skip kalau cuma nak avatar shot je.",
          },
          {
            title: "Step 5 — Pick Prompt Mode",
            description:
              "Tab Avatar (default) — preset persona: Kebaya 20s / Casual 20s / Makcik / Kitchen / dll. Tab Product — preset shots produk. Tab Sales — gambar marketing-style. Pick preset OR taip custom prompt.",
            tip:
              "Kalau pilih preset, button 'Pakcik' / 'Kebaya 20s' dll auto-fill prompt for you. Edit ikut kena.",
          },
          {
            title: "Step 6 — Tekan Generate Image",
            description:
              "Cost RM 0.20 per gambar. Pending card muncul kat history bawah. Tunggu 15–30 saat. Lepas siap boleh download / pakai dalam UGC tab sebagai reference.",
          },
        ],
      },
    ],
    closing:
      "Tip: gambar avatar yang korang dah generate kat sini boleh re-use dalam UGC tab → 'From History' button kat Image Reference. So generate 5–10 muka dulu, lepas tu reuse merentasi banyak video.",
  },

  // ─────────────────────────────────────────────────────────────────
  // UGC tab — Manual UGC + AI Agent UGC (both share this tab)
  // ─────────────────────────────────────────────────────────────────
  ugc: {
    pageKey: "ugc",
    title: "Tab UGC — Generate Video Selfie Style",
    subtitle: "Veo 3.1 Fast · 8 saat · vertical 9:16",
    intro:
      "Tab UGC untuk korang generate video gaya selfie / handheld — macam orang real review produk dalam Bahasa Melayu. Avatar kat kamera, pegang produk, cakap dialog yang korang tulis. Sesuai untuk affiliate / TikTok Shop content.",
    whenToUse:
      "Bila korang nak SATU video UGC sahaja dengan dialog specific yang korang dah ada idea. Kalau nak banyak video sekali gus dengan AI plan, guna Tab Auto Content. Kalau nak chat dengan AI untuk bantu draft, scroll bawah ada AI Agent UGC.",
    sections: [
      {
        heading: "Cara guna Manual UGC (form atas)",
        steps: [
          {
            title: "Step 1 — Form UGC overview",
            image: "/sop/ugc/step-1-form-overview.png",
            imageAlt: "Full UGC form: Video Generator, Scene, Size, Generate UGC",
            description:
              "Ni semua bahagian yang korang akan isi. Video Generator (atas) — pilih duration (8s) + Image Mode. Scene (tengah) — upload gambar produk + tulis dialog/prompt + tekan Prompt Builder kalau stuck. Size (bawah) — biasa 9:16 untuk TikTok. Generate UGC — fire button kuning besar.",
            tip:
              "Modal punya layout sama je pada mobile, cuma scroll je naik turun.",
          },
          {
            title: "Step 2 — Pilih Image Mode (3 pilihan)",
            description:
              "Product Reference (default — paling best, AI buat scene sendiri ikut produk), First Frame (frame pertama dari image korang), atau Text to Video (no image, full description).",
            tip:
              "Untuk product review yang natural: pakai Product Reference. Avatar akan auto-letak pegang produk dalam scene yang sesuai.",
          },
          {
            title: "Step 3 — Upload Image Reference",
            description:
              "Tekan butang Upload atau drag gambar produk masuk. Tekan 'History' kalau nak guna gambar dari project sebelum ni. X untuk buang gambar.",
            tip: "Gambar produk yang clear (single subject, lighting OK) hasil video paling best. Avoid background busy.",
          },
          {
            title: "Step 4 — Tulis Scene Prompt + Dialog",
            description:
              "Describe scene + dialog yang korang nak avatar cakap. Sweet spot 18–22 perkataan untuk dialog (sebab Veo 8 saat). Format: setting + action + dialog dalam 2–3 ayat.",
            tip:
              "Contoh: 'Malay woman in kitchen, holding a jar of sambal, smiling at camera, says: \"Korang, sambal ni gila pedas! Aku makan setiap hari sekarang. Cuba la!\"' Tulis natural macam korang cakap dengan kawan.",
          },
          {
            title: "Step 5 — Tekan Prompt Builder (jika stuck)",
            description:
              "Butang Prompt Builder (top-right Scene card) — wizard akan tanya korang beberapa soalan (persona, scene, hook, framework, voice, dialog) lepas tu auto-generate prompt yang siap untuk korang edit/copy.",
            tip:
              "Prompt Builder wajib untuk first-timer. Lepas dah biasa, korang boleh tulis sendiri direct.",
          },
          {
            title: "Step 6 — Set SIZE + Generate UGC",
            description:
              "Default 9:16 (vertical TikTok). Tekan Generate UGC button kuning besar. Pending card akan muncul kat history bawah. Tunggu 60–90 saat untuk Veo 3.1 Fast siap. Cost RM 0.40 per video.",
            tip:
              "Boleh generate banyak sekali gus — tekan Generate berulang dengan prompt slightly different.",
          },
        ],
      },
      {
        heading: "Cara guna AI Agent UGC (chat panel)",
        steps: [
          {
            title: "Step 7 — Buka AI Agent UGC",
            description:
              "Floating chat button kat bottom-right corner (icon bulat hijau dengan bubble). Tekan untuk buka panel AI Agent. Agent ni boleh chat dengan korang dalam BM, propose video variants, dan submit terus untuk generate.",
            tip:
              "Agent UGC ada library skill (persona, scene, hook, framework, voice) yang dia auto-fetch. Korang cuma cakap apa korang nak.",
          },
          {
            title: "Step 8 — Cerita Apa Korang Nak",
            description:
              "Type natural macam chat WhatsApp. Contoh: 'Buat 3 video UGC untuk produk skincare aku, persona urban hijabi, hook pain confession'. Boleh attach gambar produk juga (ikon clip kat input chat).",
            tip:
              "Agent akan tanya soalan ikut bila perlu — duration 8s ke 16s, voice id, hijab/no hijab, etc. Reply dengan jawapan, dia continue.",
          },
          {
            title: "Step 9 — Type SUBMIT untuk Fire Generate",
            description:
              "Bila agent dah ready propose variants, dia akan tunjuk preview dan minta korang type 'SUBMIT' untuk fire generate. Confirmation dialog akan keluar dengan list variants — review sekali lagi, edit kalau perlu, then approve.",
            tip:
              "Boleh request video type product (no person, voiceover only) dengan cakap 'buat video type product, tanpa orang'. Agent akan switch ke Template B mode.",
          },
        ],
      },
      {
        heading: "Lepas Generate — History Grid",
        steps: [
          {
            title: "Step 10 — History Grid",
            image: "/sop/ugc/step-9-history.png",
            imageAlt: "History grid showing generated videos with action buttons",
            description:
              "Bawah form ada History — UGC — <projek>. 3 video per row (mobile), 4 (desktop). Setiap card: thumbnail, label model (Veo 3.1 • P1/P2), nama editable, action buttons (Extend, Combine, Improve, Download, Delete).",
            tip:
              "Tekan thumbnail untuk full-screen player. Tekan ikon 🔄 atas-kanan card kalau pending lama (manual recheck status).",
          },
          {
            title: "Step 11 — Extend ke 16 Saat (optional)",
            description:
              "Card status 'done' ada butang 'Extend' (kuning). Click → modal untuk segment-2 prompt (continuation 8 saat lagi). System auto-merge seg-1 + seg-2 jadi video 16 saat.",
            tip:
              "Pakai Frame Anchor 'last' untuk continuation natural. Voice locked dari seg-1 supaya bunyi same orang.",
          },
        ],
      },
    ],
    closing:
      "Tip terakhir: Modesty rule auto-applied untuk semua persona (long sleeves, no cleavage, no thigh exposure) — selamat untuk audience Malaysia. Voice dialog stays 20–24 patah perkataan BM untuk audio sync paling sempurna.",
  },

  // ─────────────────────────────────────────────────────────────────
  // AUTO CONTENT tab
  // ─────────────────────────────────────────────────────────────────
  "auto-content": {
    pageKey: "auto-content",
    title: "Tab Auto Content — Banyak Video Sekali Klik",
    subtitle: "AI → Image → Video → Merge · 1-10 video per batch",
    intro:
      "Auto Content tab untuk korang generate BANYAK video UGC sekaligus dari satu produk. Korang paste link TikTok Shop / Shopee atau upload product manual → AI plan 5–10 angle berbeza (UGC + Product + Lifestyle) → fire semua → caption + cover text auto-saved untuk auto-post.",
    whenToUse:
      "Bila korang nak content monthly batch (10–30 video) untuk satu produk. Atau bila nak test banyak hook/framework sekali jumpa mana paling viral. Kalau cuma 1 video je, guna Tab UGC saja.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Form Auto Content overview",
            image: "/sop/auto-content/overview.png",
            imageAlt: "Auto Content tab full form",
            description:
              "Affiliate (paste link TikTok Shop) ATAU Manual Product (upload gambar + tulis info). Lepas tu set Gender + Style + Age avatar. Pilih duration 8s atau 16s. Plan Mode AI Plan (auto) atau Manual Plan. Pick frameworks. Set CTA mode. Quantity 1–10.",
          },
          {
            title: "Step 2 — Affiliate vs Manual Product",
            description:
              "Affiliate (default) — paste link TikTok Shop / Shopee → AI auto-scrape nama + harga + image. Manual Product — upload gambar + tulis info sendiri. Untuk product baru / private listing, Manual.",
            tip:
              "Untuk affiliate: link pendek vt.tiktok.com tak boleh fetch. Buka link dalam browser dulu, copy URL penuh /pdp/... balik.",
          },
          {
            title: "Step 3 — Pilih History Saved Products (icon 🕐)",
            description:
              "Kalau dah pernah fetch produk sebelum ni, icon 🕐 di sebelah input akan tunjuk count. Click → list saved products → pick balik tanpa burn another scrape call.",
          },
          {
            title: "Step 4 — Set Avatar Persona",
            description:
              "Gender (Female / Male). Style (Hijab / No Hijab — Female only, auto-hide untuk Male). Age (20s / 30s / 40s Makcik / 55+ Nenek). Avatar yang sama akan muncul dalam semua UGC frameworks.",
          },
          {
            title: "Step 5 — Pick Duration + Size",
            description:
              "8s (1 shot) — paling cepat, paling murah. 16s (2 shots) — auto-merge dua segmen 8 saat jadi satu video panjang. Size 9:16 (TikTok default).",
          },
          {
            title: "Step 6 — Pick Frameworks",
            description:
              "Tick UGC frameworks (Hook+Pain, Testimonial, FOMO, dll) untuk video character speaking. Tick PRD frameworks (Product Hero, Before/After) untuk video produk-only voiceover. LIFE (lifestyle) — character dalam scene aesthetic.",
            tip:
              "Mix UGC + PRD untuk variety. Pick max 5 frameworks (= 5 video). Each framework = different angle.",
          },
          {
            title: "Step 7 — CTA Mode",
            description:
              "Shop CTA — auto-rotate 30 'tekan beg kuning' variations. Custom CTA — tulis sendiri. No CTA — content je, no salesy.",
          },
          {
            title: "Step 8 — Quantity + Generate",
            description:
              "Quantity 1–10 video per batch. Tekan Generate — AI master-plan dulu (~30 saat) → image gen (kalau ada) → video gen (~60-90 saat per video). Total 5–8 minit untuk 5 videos.",
            tip:
              "Caption + cover_title + cover_subtitle + 5 hashtags auto-saved untuk setiap video. Auto-post extension boleh fire terus dari history.",
          },
        ],
      },
    ],
    closing:
      "Auto Content paling powerful bila combine dengan Auto Post extension (Chrome). Generate batch → review → schedule post hourly via TikTok native scheduler → laptop boleh tutup, TikTok handle posting sendiri.",
  },

  // ─────────────────────────────────────────────────────────────────
  // STORY tab — Cinema Generator (Grok Imagine)
  // ─────────────────────────────────────────────────────────────────
  story: {
    pageKey: "story",
    title: "Tab Story — Cinematic AI Video",
    subtitle: "Grok Imagine 3 · 6-30 saat · cinematic style",
    intro:
      "Story tab untuk korang generate video sinematik (drone shots, action sequences, dramatic scenes) yang TAK perlu UGC face talking. Pakai Grok Imagine — model paling kuat untuk movie-style footage. Sesuai untuk landing page hero, brand cinematic, ad transitions.",
    whenToUse:
      "Bila korang nak video yang cantik macam trailer movie — pemandangan, action shot, slow-mo dramatic, alien attack, jungle chase, dll. Bukan untuk product review. Bukan untuk dialog. Just visual cinematic.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Cinema Generator overview",
            image: "/sop/story/overview.png",
            imageAlt: "Story tab Cinema Generator form",
            description:
              "Image Mode (Text to Video / First Frame / Last Frame). Scene prompt (long descriptive — sampai 5000 char). Duration slider (6–30 saat). Size 9:16 / 16:9. Generate Cinema button purple besar.",
          },
          {
            title: "Step 2 — Pilih Image Mode",
            description:
              "Text to Video (default) — purely text description. First Frame — upload gambar untuk start scene. Last Frame — upload gambar untuk end scene. Untuk continuation video, last frame paling useful.",
          },
          {
            title: "Step 3 — Tulis Cinematic Prompt (LONG description)",
            description:
              "Berbeza dari UGC, Story prompt LONG — 200-500 perkataan. Description pasal characters, actions, camera movement, lighting, mood. Pakai cinematic language: 'POV tracking shot', 'dramatic lighting', 'slow-motion', 'volumetric haze'.",
            tip:
              "Contoh: 'A cinematic drone shot gliding over a snowy mountain village at sunrise, warm window lights flickering in the blue morning haze, slow camera dolly, atmospheric fog, golden hour rim lighting.' Lebih detail = lebih sinematik.",
          },
          {
            title: "Step 4 — Pilih Duration",
            description:
              "Default 6 saat (paling murah ~RM 0.18). Maximum 30 saat. Cost = RM 0.03 per saat. Slider drag → tengok cost update real-time.",
            tip:
              "Untuk hero video landing page: 8–12 saat sweet spot. Lebih panjang = budget burns fast.",
          },
          {
            title: "Step 5 — Generate Cinema",
            description:
              "Tekan Generate Cinema button purple. Pending card kat history bawah. Veo Cinema lebih lambat dari UGC — tunggu 90–180 saat untuk siap.",
            tip:
              "Output ada 'PRODUCT REF' label kalau ada reference image, atau 'TEXT TO VIDEO' kalau pure text. Both sebagai 'Story' tab untuk distinguish dari UGC product reviews.",
          },
        ],
      },
    ],
    closing:
      "Story videos work best as standalone cinematic pieces — combine dengan UGC voice-over dalam editor luar (CapCut / Premiere). Atau pakai Story sebagai 'B-roll' kat bawah UGC untuk variety.",
  },

  // ─────────────────────────────────────────────────────────────────
  // CINEMA tab — Seedance 2.0
  // ─────────────────────────────────────────────────────────────────
  cinema: {
    pageKey: "cinema",
    title: "Tab Cinema — Seedance 2.0",
    subtitle: "Bytedance Seedance 2.0 · 4-15 saat · text/reference-to-video",
    intro:
      "Cinema (Seedance 2.0) tab — model Bytedance yang paling baru. Strength: action sequences, multi-shot consistency, native audio generation, character-specific reference. Boleh pakai sampai 4 reference images + 1 reference video + 1 reference audio.",
    whenToUse:
      "Bila Veo (UGC tab) atau Grok (Story tab) tak cukup — Seedance handle scenes yang complex (multi-character interaction, action choreography, audio sync). Bila nak avatar AI yang konsisten merentasi banyak shots dengan voice yang sama.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Cinema (Seedance) overview",
            image: "/sop/cinema/overview.png",
            imageAlt: "Cinema tab Seedance form",
            description:
              "Title bar 'Cinema · Seedance 2.0' tunjuk arrow TEXT → VIDEO atau REFERENCE → VIDEO. Long prompt textarea (5000 char). Reference images slot (max 4). Aspect Ratio + Duration slider 8s default. Cost calculator + Generate button.",
          },
          {
            title: "Step 2 — Long Descriptive Prompt",
            description:
              "Seedance suka prompt PANJANG dan detailed (200–500 perkataan). Cover: characters (specific looks), actions (verb-by-verb), camera movements, lighting, mood, soundscape. Macam Story tab tapi boleh tambah audio cues.",
            tip:
              "Pakai 'cuts' / 'cut' antara scenes untuk multi-shot sequence. Seedance handle smooth transitions antara cuts.",
          },
          {
            title: "Step 3 — Reference Images (optional, up to 4)",
            description:
              "Tekan + button. Upload character reference, product reference, scene reference, audio reference. Seedance combine semua → AI fuse jadi satu coherent video. Auto-switch ke 'Reference to Video' mode bila ada reference.",
            tip:
              "Untuk avatar consistency merentasi banyak shots — upload 1 selfie sebagai character reference. Seedance kekalkan muka tu sepanjang video walaupun multiple cuts.",
          },
          {
            title: "Step 4 — Set Duration",
            description:
              "Slider 4–15 saat. Default 8 saat. Cost = RM 0.40 per saat (admin tunable). Tengok COST line kat bawah update real-time.",
          },
          {
            title: "Step 5 — Generate",
            description:
              "Tekan Generate button kuning. Pending card → status check. Seedance lambat sikit dari Veo — tunggu 2–4 minit untuk siap. Output muncul dengan label 'Seedance • P1' atau 'Seedance • P2'.",
            tip:
              "Kalau pending forever (>5 min), tekan icon refresh atas-kanan card untuk manual status check. Webhook kadang miss.",
          },
        ],
      },
    ],
    closing:
      "Seedance audio native — kalau prompt korang ada description bunyi (BGM, ambient, dialog), output video dah ada audio sekali. Jangan duplicate dengan VO luar.",
  },

  // ─────────────────────────────────────────────────────────────────
  // CLONE PROMPT tab
  // ─────────────────────────────────────────────────────────────────
  "clone-prompt": {
    pageKey: "clone-prompt",
    title: "Tab Clone Prompt — Curi Formula Video Viral",
    subtitle: "Frames → AI → Prompt(s) · reverse-engineer any video",
    intro:
      "Clone Prompt tab — paste / upload video viral orang lain → AI extract frames → reverse-engineer jadi Veo prompts yang korang boleh pakai untuk recreate similar video. Output prompt sahaja, tak generate video terus. Korang copy prompt → pakai dalam UGC / Auto Content tab.",
    whenToUse:
      "Bila korang tengok video viral kompetitor / creator dan nak buat similar version untuk produk korang. Bila nak study struktur prompt yang berkesan. Bila stuck idea dan nak inspirasi dari output yang dah confirmed performing.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Clone Prompt overview",
            image: "/sop/clone-prompt/overview.png",
            imageAlt: "Clone Prompt tab",
            description:
              "Upload Reference Video (drop video file) atau paste URL. Pick Output (UGC / Cinema / Story). Pick Size. Tulis Dialog (optional — kalau kosong, AI follow reference exactly). Generate Prompt button merah.",
          },
          {
            title: "Step 2 — Upload Reference Video",
            description:
              "Drag video file (mp4, mov) ATAU paste TikTok URL. Max ~60 saat — lebih panjang akan dibahagi segmen. AI extract key frames (start, middle, end) automatically.",
          },
          {
            title: "Step 3 — Pilih Output Type",
            description:
              "UGC — character-focused prompt untuk Veo 3.1 (8-16s). Cinema — Seedance 2.0 prompt untuk action/cinematic. Story — Grok Imagine prompt untuk dramatic visuals.",
            tip:
              "Kalau reference video ada orang cakap, pilih UGC. Kalau scene cinematic without dialog, Cinema/Story.",
          },
          {
            title: "Step 4 — Dialog Override (optional)",
            description:
              "Field optional. Kalau dibiarkan kosong, AI generate dialog yang ikut reference. Kalau korang mahu dialog korang sendiri, format timestamps:\n0s-4s Hook line\n4s-8s Value/proof\n8s-12s Build-up\n12s-16s CTA",
            tip:
              "Untuk produk korang, override dengan dialog yang mention produk/CTA korang. Skeleton dari reference, content from korang.",
          },
          {
            title: "Step 5 — Generate Prompt",
            description:
              "Tekan Generate Prompt button. Tunggu 30–60 saat. Output appears di History — Clone — <projek>. Card show: number of segments + scene description + character lock + dialog timeline.",
            tip:
              "Click card → full prompt modal → Copy. Paste dalam UGC tab Scene prompt OR dalam Cinema tab. Edit ikut produk korang.",
          },
        ],
      },
    ],
    closing:
      "Clone Prompt = curi struktur, bukan curi content. Output prompt ada character locks, voice locks, anchor scene logic — semua benda yang make a viral video work. Adapt untuk produk korang dan fire dalam UGC/Cinema tab.",
  },

  // ─────────────────────────────────────────────────────────────────
  // BILLING — Pro plan management
  // ─────────────────────────────────────────────────────────────────
  billing: {
    pageKey: "billing",
    title: "Billing — Subscription Pro Plan",
    subtitle: "RM 75 / bulan · access semua tab generation",
    intro:
      "Billing page tunjuk status Pro Plan korang — bila renew, status active, rates per generation, payment history. Pro Plan unlocks semua tab (Image / UGC / Auto Content / Story / Cinema / Clone). Tanpa Pro, tab generation locked.",
    whenToUse:
      "Untuk tengok bila plan expire, cancel subscription, tengok payment history. Atau bila ada masalah payment / nak switch payment method.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Billing overview",
            image: "/sop/billing/overview.png",
            imageAlt: "Billing page with Pro Plan card and payment history",
            description:
              "Card 'Pro Plan' atas tunjuk: status Active, renewal date (auto-renew), rates per asset (Image RM 0.20, Video 8s RM 0.40), Cancel subscription button. Payment history bawah list semua transactions.",
          },
          {
            title: "Step 2 — Cancel / Renew Subscription",
            description:
              "Tekan 'Cancel subscription' kalau nak stop auto-renew. Plan stay active sampai end of period, lepas tu lapse. Untuk renew lepas lapse, login balik dan pilih Pro plan dari landing page.",
            tip:
              "Cancel TIDAK refund — korang continue access sampai end of paid period.",
          },
          {
            title: "Step 3 — Payment Status",
            description:
              "Status column: Success (paid OK), Pending (processing), Failed (payment error — retry). Kalau Failed, tekan 'Check' button untuk re-trigger Chip payment retry.",
          },
        ],
      },
    ],
    closing:
      "Billing handled via Chip (Malaysia payment gateway) — FPX, e-wallet, credit card supported. Auto-renew bulanan kecuali korang cancel. Notification email + WhatsApp 3 hari sebelum renewal.",
  },

  // ─────────────────────────────────────────────────────────────────
  // TOP UP CREDIT
  // ─────────────────────────────────────────────────────────────────
  "top-up": {
    pageKey: "top-up",
    title: "Top Up Credit — Tambah Kredit Generation",
    subtitle: "RM 1 = 1 kredit · tak hangus · pakai bila-bila",
    intro:
      "Top Up Credit page — beli kredit untuk generation. Setiap kali korang generate image / video, kredit akan deducted. Pro plan dah include sebahagian kredit, tapi kalau habis, top up sini.",
    whenToUse:
      "Bila Credit Balance dah dekat habis (tengok kat sidebar bottom-left, atas user info card). Atau bila nak buat batch besar (auto content batches consume kredit cepat).",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Top Up overview",
            image: "/sop/top-up/overview.png",
            imageAlt: "Top up page with credit balance + packages",
            description:
              "Atas tunjuk Credit Balance current + estimate berapa images / videos boleh generate. Bawah ada packages: 10 / 20 / 30 / 50 (BEST) / 100 credits. Tekan package → Pay button → Chip checkout.",
          },
          {
            title: "Step 2 — Pilih Package",
            description:
              "RM 1 = 1 kredit. 10 credits (Starter) → RM 10. 50 credits (Best value) → RM 50. 100 credits (Power user) → RM 100. Tak ada subscription / recurring — one-time top up.",
            tip:
              "50 credits sweet spot untuk client serious. ~250 images atau ~125 videos 8s. Lasts about 2 weeks of regular usage.",
          },
          {
            title: "Step 3 — Pay via Chip",
            description:
              "Tekan 'Pay RMxx for xx Credits'. Redirect ke Chip checkout (FPX / e-wallet / card). Selesai payment → balik ke dashboard, kredit auto-add dalam ~10 saat (webhook).",
            tip:
              "Kalau kredit tak masuk lepas 1 minit, refresh dashboard. Webhook kadang lambat sikit.",
          },
        ],
      },
    ],
    closing:
      "Kredit TAK hangus (no expiry). Beli sekali, pakai sampai habis. Kalau kompetitor offer 'subscription credits' yang reset bulanan, ours stack across months.",
  },

  // ─────────────────────────────────────────────────────────────────
  // USAGE
  // ─────────────────────────────────────────────────────────────────
  usage: {
    pageKey: "usage",
    title: "Usage — Tracking Spend & Activity",
    subtitle: "Filter activity · tengok credit deductions",
    intro:
      "Usage page tunjuk SEMUA activity korang — setiap image, video, auto-content batch yang dah di-generate, dengan cost breakdown. Filter ikut tab. Useful untuk monthly review / accounting.",
    whenToUse:
      "Bila nak audit spending bulan ni. Bila wonder mana credit pergi cepat sangat. Bila nak compare productivity (berapa video per minggu).",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Usage overview",
            image: "/sop/usage/overview.png",
            imageAlt: "Usage page with stats cards + activity table",
            description:
              "4 stats cards atas: Total Spend, Images generated, Videos generated, Auto Plans batched. Filter pills (All / Image / Video / Auto / Clone / Post). Activity table dengan kolum Action / Prompt / Preview / Date / Credit / Balance.",
          },
          {
            title: "Step 2 — Filter ikut Tab",
            description:
              "Tekan filter pill — 'All' (default), Image (image generations), Video (UGC + Cinema + Seedance), Auto (auto-content batches), Clone (clone-prompt), Post (auto-post extension activity).",
            tip:
              "Untuk tengok mana paling burn credit: tekan Video filter, sort by date. Usually Auto Content batches yang paling consume.",
          },
          {
            title: "Step 3 — Tengok Credit Trail",
            description:
              "Setiap row ada 'Credit' column (negative = deducted) + 'Balance' column (running total selepas transaction). Boleh trace exactly bila balance drop.",
          },
        ],
      },
    ],
    closing:
      "Date range filter kat atas table boleh narrow ke specific period. Untuk monthly accounting, set start=1 first of month, end=last day, export screenshot ke client.",
  },

  // ─────────────────────────────────────────────────────────────────
  // SAVED PROMPTS
  // ─────────────────────────────────────────────────────────────────
  "saved-prompts": {
    pageKey: "saved-prompts",
    title: "Saved Prompts — Library Prompt Yang Berjaya",
    subtitle: "Auto-saved every successful generation · star wins",
    intro:
      "Saved Prompts page = library prompts yang dah berjaya generate output (DONE status). Auto-saved untuk korang. Star yang paling viral — AI agents akan learn dari starred prompts bila plan content baru.",
    whenToUse:
      "Bila korang nak re-use prompt yang dah confirmed work. Bila nak browse output korang sendiri tahun ini. Bila nak teach AI agents your style preferences via stars.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Saved Prompts overview",
            image: "/sop/saved-prompts/overview.png",
            imageAlt: "Saved Prompts library with cards + filters",
            description:
              "Search bar. Filter pills (All / UGC Plan / Cinema Plan / Auto Plan). Project filter dropdown + Starred Only toggle + Refresh icon. 'Showing X of Y prompts' counter. Cards with full prompt body + Copy button + Delete.",
          },
          {
            title: "Step 2 — Search + Filter",
            description:
              "Search bar match scene name / persona / hook / dialog excerpt. Filter pills narrow to plan type. 'All projects' dropdown atau pick specific project. 'Starred Only' = favorites view.",
          },
          {
            title: "Step 3 — Star + Copy + Delete",
            description:
              "⭐ icon top-right card — toggle star untuk favorite. 'COPY' button bawah — copy full prompt to clipboard, paste dalam UGC / Cinema / Auto Content tab. 🗑️ delete icon — buang dari library.",
            tip:
              "Star prompts yang viral kat TikTok / yang client suka. AI agents learn dari starred prompts bila propose new content.",
          },
        ],
      },
    ],
    closing:
      "Saved Prompts auto-purges old / unused prompts after 90 hari. Star untuk preserve forever. Library limit 200 prompts.",
  },

  // ─────────────────────────────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────────────────────────────
  settings: {
    pageKey: "settings",
    title: "Settings — Profile + Provider + Password",
    subtitle: "Account info, video provider override, password change",
    intro:
      "Settings page — semua personal config korang. Profile (display name + email). WhatsApp number untuk login + support notif. Video Provider override (P1/P2 default). Change password.",
    whenToUse:
      "Bila baru sign up — set display name + WhatsApp. Bila nak swap video engine (P1 atau P2). Bila nak change password.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Settings overview",
            image: "/sop/settings/overview.png",
            imageAlt: "Settings page with Profile, WhatsApp, Video Provider, Password",
            description:
              "4 cards: Profile (display name + email locked), WhatsApp (phone number + Save), Video Provider (P2 Default / P1 toggle — applies to NEW videos sahaja), Change Password (old + new + confirm).",
          },
          {
            title: "Step 2 — Set WhatsApp Number",
            description:
              "Format +60123456789 (international format). Save. Korang akan dapat login OTP + support notif via WhatsApp. Wajib untuk password reset.",
          },
          {
            title: "Step 3 — Video Provider P1 / P2",
            description:
              "P2 (Default) — Crun.ai backend, faster Veo Fast. P1 — GeminiGen backend, sometimes better quality. Switch kalau output dari one provider tak quality.",
            tip:
              "Setting ni override PER-USER. Admin still control default. In-flight rows continue dengan original provider.",
          },
          {
            title: "Step 4 — Change Password",
            description:
              "Old password + new + confirm new. Klik Change Password. Lepas tu kena re-login. Kalau lupa old password, hubungi admin via WhatsApp untuk reset.",
          },
        ],
      },
    ],
    closing:
      "Email locked (kena admin tukar). Display name + WhatsApp + provider + password — boleh edit sendiri. Settings auto-save except password (kena confirm).",
  },
};
