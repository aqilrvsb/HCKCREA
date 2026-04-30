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
  // DASHBOARD / PROJECT — landing page with project picker
  // ─────────────────────────────────────────────────────────────────
  dashboard: {
    pageKey: "dashboard",
    title: "Dashboard — Project & Production Summary",
    subtitle: "Welcome screen · pick / create project · daily stats",
    intro:
      "Dashboard ialah landing page bila korang first kali login. Dia tunjuk ringkasan production keseluruhan (total Image / UGC / Cinema / Auto Content + Total Cost) dan jadi launchpad untuk pilih project mana yang nak kerja. Semua tab generation (Image / UGC / Auto Content / Story / Cinema / Clone) live DALAM satu project — korang mesti pilih atau buat project dulu sebelum generate apa-apa.",
    whenToUse:
      "Setiap kali korang login. Atau bila nak switch antara client / campaign berbeza. Atau bila nak tengok overall production stats — berapa banyak generated bulan ni, total cost, daily breakdown.",
    sections: [
      {
        heading: "Cara guna",
        steps: [
          {
            title: "Step 1 — Dashboard overview",
            image: "/sop/dashboard/overview.png",
            imageAlt: "Dashboard with stats cards + filter + daily production chart",
            description:
              "Atas: 5 stats cards (Image / UGC / Cinema / Auto Content / Total Cost) untuk date range yang dipilih. Tengah: Filter by Date Range — set From + To + Apply. Bawah: Daily Production line chart — tunjuk activity per day.",
          },
          {
            title: "Step 2 — Apa itu PROJECT?",
            description:
              "Project = bekas (folder) untuk satu client / satu campaign / satu produk. SEMUA generation korang (image, video, auto content, dll) live dalam satu project specific. History grid kat setiap tab show data project tu sahaja.\n\nContoh:\n• Project 'meow' — untuk client A skincare brand\n• Project 'Project 1' — untuk client B yoga pants\n\nTukar project kat sidebar = tukar context. Stats + history beralih ikut project yang aktif.",
          },
          {
            title: "Step 3 — Buat New Project",
            description:
              "Sidebar atas ada button '+ New project' (orange). Tekan → modal popup. Masukkan project name (e.g. 'Brand X Campaign Q1') → Create. Project baru muncul kat sidebar Projects list.\n\nLimit max 4 projects per akaun (badge '2/4' tunjuk current usage). Untuk lebih, perlu hubungi admin upgrade plan.",
            tip:
              "Naming tip: pakai nama yang specific. 'Skincare-A-Aug-Campaign' lebih clear dari 'Project 5'.",
          },
          {
            title: "Step 4 — Switch antara Projects",
            description:
              "Sidebar 'PROJECTS' section senaraikan semua project korang. Tekan project name → semua tab generation switch ke project tu. URL update ke ?view=<tab> dan history grid reload.\n\nKalau project tak ada (deleted), 'Project not found' message muncul — tekan project lain dari sidebar.",
          },
          {
            title: "Step 5 — Search Projects (kalau dah banyak)",
            description:
              "Search bar kat atas sidebar — type nama project untuk filter. Useful bila dah ada 10+ projects (tapi limit 4 default, jadi rare).",
          },
          {
            title: "Step 6 — Project menu (3-dot)",
            description:
              "Hover atas project name → 3-dot menu muncul → boleh Rename atau Delete project.\n\nDelete project = WARNING. Semua history dalam tu hilang permanently. Confirm dialog akan tanya dulu. Tak ada undo.",
            tip:
              "Rename anytime safe. Delete cuma kalau project memang dah expired / abandoned.",
          },
        ],
      },
      {
        heading: "Detail — Stats Cards & Filter",
        steps: [
          {
            title: "Card 'IMAGE / UGC / CINEMA / AUTO CONTENT'",
            description:
              "Total count generation per asset type dalam date range yang dipilih.\n\n• IMAGE — gambar yang di-generate kat Image tab\n• UGC — video Veo 8s/16s dari UGC tab\n• CINEMA — video Seedance dari Cinema tab + video Grok dari Story tab combined\n• AUTO CONTENT — total videos dari Auto Content batches\n\nClick stats card (kalau interactive) → drill down ke specific tab history.",
          },
          {
            title: "Card 'TOTAL COST'",
            description:
              "Sum credit deducted untuk semua generation dalam date range. Format RM. Useful untuk monthly accounting / billing client.",
            tip:
              "Untuk monthly invoice: set From=01 + To=last day of month, Apply, screenshot Total Cost.",
          },
          {
            title: "FILTER BY DATE RANGE",
            description:
              "FROM DATE — earliest date to include.\nTO DATE — latest date to include.\nAPPLY button — refresh stats with new range.\nReset button — back to default (current month).\n\nKL timezone (UTC+8) — tarikh local Malaysia.",
          },
          {
            title: "DAILY PRODUCTION chart",
            description:
              "Line chart untuk visual trend. Setiap line satu asset type (color-coded). X-axis = dates. Y-axis = count generated.\n\n'42 total in range' = jumlah keseluruhan untuk filter aktif.\n\nClick legend (Image / UGC / Cinema / Auto Content) untuk toggle line on/off.",
            tip:
              "Useful untuk identify spike days (campaign launches) atau gap (vacation / sakit).",
          },
        ],
      },
      {
        heading: "Sidebar Layout — Apa Setiap Section",
        steps: [
          {
            title: "Top — Logo & Dashboard button",
            description:
              "PeningLab Studio logo (click → balik ke dashboard view ini). Dashboard button (active highlighted bila kat dashboard).",
          },
          {
            title: "+ New project (orange button)",
            description:
              "Create project baru. Badge '2/4' = current count vs max limit.",
          },
          {
            title: "Projects list (search + project rows)",
            description:
              "Senarai semua project dengan icon folder. Click row → switch ke project tu. Hover → 3-dot menu (Rename / Delete).",
          },
          {
            title: "ACCOUNT section",
            description:
              "Billing — manage Pro plan + payment history\nTop Up Credit — beli credit packages\nUsage — tracking spend & activity\nSaved Prompts — library prompt history\nAuto Post TikTok — install Chrome extension SOP\nJoin Discussion WhatsApp — community group",
          },
          {
            title: "CREDIT BALANCE card",
            description:
              "Current credit balance + Top Up shortcut button. Auto-refresh setiap 30 saat.",
          },
          {
            title: "PRO · 57 DAYS LEFT badge",
            description:
              "Plan status + days till renewal. Hover atau click → Billing page untuk manage.",
          },
          {
            title: "User card bawah sekali",
            description:
              "Display name + email. Settings + Sign out buttons.",
          },
        ],
      },
    ],
    closing:
      "Workflow tip: buat 1 project per client. Generate 1 batch monthly content (5-10 videos via Auto Content). Review kat history grid → mark posted via extension. Bulan baru → reset counter + reuse project. Dashboard stats akan tunjuk progression korang merentasi bulan.",
  },

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
            title: "Step 2 — Upload Character Reference",
            description:
              "Drag muka avatar yang korang nak guna (selfie clear). AI akan kekalkan muka tu dalam SEMUA variation yang korang generate. Boleh pakai 'From History' kalau dah pernah generate.",
            tip:
              "1 muka clear je — kalau ramai orang dalam gambar reference, AI akan confused.",
          },
          {
            title: "Step 3 — Upload Product Reference (kalau ada)",
            description:
              "Drag gambar produk korang (packaging, label clear). AI akan kekalkan produk tu pixel-perfect dalam scene. Skip kalau cuma nak avatar shot je.",
          },
          {
            title: "Step 4 — Tekan Generate Image",
            description:
              "Cost RM 0.20 per gambar. Pending card muncul kat history bawah. Tunggu 15–30 saat. Lepas siap boleh download / pakai dalam UGC tab sebagai reference.",
          },
        ],
      },
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Dropdown 'MODEL' — pilih engine AI",
            description:
              "Banana Pro (default) — Google nano-banana-pro. Paling stable untuk muka Malaysia, character consistency tinggi. Best untuk avatar.\n\nGPT Image 2 — OpenAI gpt-image-2. Paling kreatif untuk scene aesthetic, tapi muka kadang less consistent.\n\nImagen 4 — Google Imagen 4. Paling realistic untuk product shots, mahal sikit credit.",
            tip:
              "Mula dengan Banana Pro untuk semua avatar work. Switch ke GPT Image 2 bila nak scene unik. Imagen 4 untuk hero shots yang nak premium look.",
          },
          {
            title: "Dropdown 'MODE' — what type of operation",
            description:
              "Create Image (default) — generate dari scratch ikut prompt + reference.\n\nMode lain (kalau ada) cover edit / inpaint use case yang advanced — biasanya tak perlu untuk UGC workflow standard.",
            tip:
              "Stick dengan Create Image untuk 95% case.",
          },
          {
            title: "Tab 'AVATAR / PRODUCT / SALES' — preset prompt mode",
            description:
              "Avatar (default) — preset untuk muka avatar: Female persona pills (Kebaya 20s, Casual 20s, Makcik, Kitchen, Nenek, Nenek Garden) + Male pills (Baju Melayu 20s, Casual 20s, Abang Pro, Pakcik).\n\nProduct — preset shots produk macam flat lay, pedestal, splash.\n\nSales — gambar marketing-style untuk ads / banners.",
            tip:
              "Tap preset button = auto-fill prompt for you. Boleh edit selepas tu.",
          },
          {
            title: "Pills 'KEBAYA 20s / CASUAL 20s / MAKCIK / KITCHEN / NENEK / NENEK GARDEN'",
            description:
              "Female persona presets:\n• Kebaya 20s — anak dara modern, traditional kebaya outfit\n• Casual 20s — Gen Z hijabi, daily casual modern\n• Makcik — 40s, baju kurung, warm motherly look\n• Kitchen — kitchen scene, apron, cooking context\n• Nenek — 60s+, traditional kebaya, wisdom vibe\n• Nenek Garden — outdoor garden setting with senior woman",
            tip:
              "Untuk produk women's: Kebaya 20s atau Casual 20s. Untuk family product: Makcik. Untuk testimoni dari grandparent: Nenek.",
          },
          {
            title: "Pills 'BAJU MELAYU 20s / CASUAL 20s / ABANG PRO / PAKCIK'",
            description:
              "Male persona presets:\n• Baju Melayu 20s — young man traditional outfit\n• Casual 20s — Gen Z guy daily casual\n• Abang Pro — corporate / professional 30s look\n• Pakcik — 40s+, paternal warm look",
            tip:
              "Pakcik vibe sells trust — orang tua confirm kena beli.",
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
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Button 'DURATION 8s (1 shot)'",
            description:
              "UGC tab fixed 8 saat sahaja per generation (Veo 3.1 Fast limit). Kalau nak 16s, generate 8s dulu → tekan Extend button kat history card.\n\nKenapa 8s? Sebab dialog optimal 18-22 perkataan BM = ~7-8 saat audio. Lebih panjang = orang scroll away.",
            tip:
              "Cost RM 0.40 per 8s shot. 16s extended = RM 0.80 (2 shots + auto-merge).",
          },
          {
            title: "Dropdown 'IMAGE MODE' — 3 pilihan",
            description:
              "Product Reference (AI creates scene) — DEFAULT, paling best. Upload gambar produk → AI auto-letak avatar pegang produk dalam scene yang sesuai. Avatar muka random Malay yang natural.\n\nFirst Frame (animate from image) — upload gambar yang dah complete → AI animate jadi video. Useful kalau dah ada gambar prefect.\n\nText to Video (no image needed) — pure text description. Tak perlu gambar reference. Tapi muka avatar inconsistent across generations.",
            tip:
              "95% case: pakai Product Reference. First Frame for cinematic shots. Text to Video for cinematic / scene without product.",
          },
          {
            title: "Dropdown 'SIZE' — aspect ratio video",
            description:
              "9:16 (default) — vertical, sesuai TikTok / Reels / Shorts.\n\n16:9 — horizontal, sesuai YouTube long-form / Facebook / IG horizontal.\n\nUntuk TikTok Shop content always 9:16. 16:9 useful untuk landing page hero video.",
          },
          {
            title: "Voice Dropdown (dalam Prompt Builder modal)",
            description:
              "30 voices Veo Imagen — gender, pitch, vibe berbeza:\n• achernar — Female, soft, high pitch (gentle airy)\n• callirrhoe — Female, easy-going, mid pitch (paling natural BM)\n• kore — Female, firm, mid (assertive)\n• leda — Female, youthful (Gen-Z trendy)\n• zephyr — Female, bright (cheerful)\n• achird — Male, friendly, mid (warm conversational)\n• alnilam — Male, firm, mid-low (authoritative)\n• fenrir — Male, excitable, younger (Gen-Z hype)\n• puck — Male, upbeat, mid (energetic)\n\nDan 21 lagi. Pick ikut emotional tone yang korang nak.",
            tip:
              "Untuk Female casual review: callirrhoe atau leda. Untuk Male confident: achird atau alnilam. Voice auto-locked across seg-1 dan seg-2 supaya seamless.",
          },
          {
            title: "Action Buttons kat History Card",
            description:
              "EXTEND (kuning) — generate 8 saat continuation, auto-merge jadi 16s.\n\nCOMBINE (purple) — pick 2-4 video, merge jadi long video manual.\n\nIMPROVE (purple icon ✨) — re-generate dengan prompt enhancement.\n\nDOWNLOAD (blue ⬇️) — save video MP4 ke device.\n\nDELETE (red 🗑️) — buang dari history.",
            tip:
              "Combine paling powerful untuk 4 angle different = 32s narrative video.",
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
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Toggle 'Affiliate / Manual Product'",
            description:
              "Affiliate (default) — paste link TikTok Shop / Shopee. AI auto-scrape semua info: nama produk, harga, gambar, deskripsi, total sold.\n\nManual Product — kalau produk private listing atau tak ada di marketplace. Korang upload gambar + tulis info sendiri (max 5 produk untuk multi-product video).",
            tip:
              "Always try Affiliate dulu — kalau tak boleh fetch (link pendek vt.tiktok.com), baru fall back ke Manual.",
          },
          {
            title: "Dropdown 'GENDER' — Female / Male",
            description:
              "Female (default) — avatar perempuan Malay. Cocok untuk produk skincare, beauty, fashion, baby, kitchen, food.\n\nMale — avatar lelaki Malay. Cocok untuk produk gym, gadget, automotive, men's grooming, business.",
            tip:
              "Female converts higher untuk most products in Malaysia (mom-buyer demographic). Male hanya untuk niche male products.",
          },
          {
            title: "Dropdown 'STYLE' — Hijab / No Hijab (Female only)",
            description:
              "Hijab (default) — avatar perempuan bertudung. Sesuai 90% audience Malaysia.\n\nNo Hijab — avatar perempuan tanpa tudung. Modesty rule still applied (long sleeves, covered, no cleavage). Useful untuk segment muslimah modern atau audience non-Muslim Malaysia.\n\nUntuk Male, dropdown Style auto-hide (tak relevan).",
            tip:
              "Test both — Hijab usually default safe. No Hijab boleh tarik audience yang relate sama lifestyle korang.",
          },
          {
            title: "Dropdown 'AGE' — 4 pilihan",
            description:
              "20s — anak dara / Gen Z, energy tinggi. Sesuai trendy products.\n\n30s — millennial mom / professional. Sesuai family / kitchen / skincare.\n\n40s (Makcik) — warm motherly. Sesuai food, kitchen, traditional medicine.\n\n55+ (Nenek) — wisdom-figure. Sesuai testimonial 'baru cuba pun dah berkesan'.",
            tip:
              "30s most universal. 40s/Makcik convert best untuk Malaysia housewife audience.",
          },
          {
            title: "Toggle '8s (1 shot) / 16s (2 shots)'",
            description:
              "8s — single Veo gen, paling cepat dan murah. RM 0.40 per video. Sesuai hook-driven content.\n\n16s — TWO Veo gens auto-chained: seg-1 (0-8s) + seg-2 (8-16s) → ffmpeg merge jadi 1 video. RM 0.80 per video. Voice + character locked across cut. Sesuai story-driven content (problem → solution arc).",
            tip:
              "16s converts better untuk emotional product (skincare, kesihatan). 8s untuk impulse product (food, gadget).",
          },
          {
            title: "Dropdown 'SIZE' — aspect ratio",
            description:
              "9:16 (default) — vertical TikTok / Reels.\n\n16:9 — horizontal Facebook / YouTube.\n\nUntuk TikTok Shop affiliate always 9:16. 16:9 untuk landing page hero atau Facebook ads.",
          },
          {
            title: "Toggle 'Plan Mode' — AI Plan / Manual Plan",
            description:
              "AI Plan (default) — AI master-plan semua angle untuk korang. Cuma korang pick frameworks + quantity, AI buat sendiri prompts + dialog + cover text.\n\nManual Plan — paste JSON prompts korang sendiri. Untuk advanced user yang dah ada plan ready dari Saved Prompts atau Clone Prompt.",
            tip:
              "AI Plan untuk 95% case. Manual Plan kalau korang follow exact viral video struktur dari competitor.",
          },
          {
            title: "Frameworks 'UGC' (15 pilihan)",
            description:
              "UGC = character on screen speaking. 9 frameworks UGC:\n\n• Hook + Pain (PAS) — confession of problem → solution\n• Testimonial — social proof storytelling\n• FOMO/Urgency — limited stock vibes\n• BAB (Before-After-Bridge) — life before vs after\n• 4Ps (Promise-Picture-Proof-Push) — structured pitch\n• Action Bias — direct call to take action\n• Solution Focus — solves specific pain\n• Benefit + Result — show outcome first\n• Fear of Loss — risk of NOT buying",
            tip:
              "UGC frameworks paling konsisten convert. PAS dan Testimonial paling viral untuk TikTok Shop.",
          },
          {
            title: "Frameworks 'PRD' (4 pilihan)",
            description:
              "PRD = product-only shot, NO person, voiceover audio. 4 frameworks:\n\n• Product Hero (AIDA) — cinematic showcase, dramatic reveal\n• Before/After — split screen comparison product effect\n• USP Showcase — close-up features dan label\n• Flat Lay / Aesthetic — product on aesthetic surface",
            tip:
              "PRD framework great for premium products (skincare, perfume, watches). Mix 1-2 PRD dengan 3-4 UGC dalam batch untuk variety.",
          },
          {
            title: "Frameworks 'LIFE' (2 pilihan — Lifestyle)",
            description:
              "LIFE = aspirational scene with character + product (Template A — character on screen):\n\n• Soft Sell (HSO — Hook-Story-Offer) — gentle storytelling, product naturally placed\n• Evening Routine — chill aesthetic with product in routine context",
            tip:
              "Lifestyle frameworks great for routine products (skincare, supplements, kitchen tools).",
          },
          {
            title: "CTA Mode (3 pilihan)",
            description:
              "Shop CTA (default) — auto-rotate 30 'tekan beg kuning' variations untuk last 2 saat. Cocok TikTok Shop affiliate.\n\nCustom CTA — tulis CTA sendiri (max 8 patah). Sesuai non-shop campaign.\n\nNo CTA — full 8s untuk content sahaja, no salesy ending. Untuk awareness / brand video.",
            tip:
              "Shop CTA convert paling tinggi untuk TikTok Shop. Test Custom CTA dengan unique offer untuk seasonal campaign.",
          },
          {
            title: "Dropdown 'QUANTITY' — 1 to 10",
            description:
              "Berapa video per batch. 1 video paling murah (RM 0.30 plan + RM 0.40 video = RM 0.70). 10 videos sweet spot untuk monthly content drop.\n\nMax 10 per batch — kalau nak 30 video, run 3 batches.",
            tip:
              "Sweet spot 5 videos = 5 frameworks different = good variety untuk A/B test.",
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
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Dropdown 'IMAGE MODE' — 3 pilihan",
            description:
              "Text to Video (default) — purely text description, no reference image. AI imagine semua dari prompt.\n\nFirst Frame (animate from image) — upload gambar yang korang nak start video dengan tu. AI animate dari frame tu.\n\nLast Frame (end at this image) — upload gambar yang korang nak akhirkan video tu dengan. Useful untuk continuation series — last frame video 1 jadi last frame target untuk video 2.",
            tip:
              "First Frame paling useful — generate cinematic start image dulu kat Image tab, lepas tu animate kat Story tab.",
          },
          {
            title: "Slider 'DURATION' — 6 to 30 saat",
            description:
              "Slider drag — minimum 6 saat, maximum 30 saat. Cost RM 0.03 per saat (admin tunable). Cost update real-time atas slider.\n\n6s — RM 0.18 (paling murah, hook video)\n10s — RM 0.30 (sweet spot)\n15s — RM 0.45 (mid-form story)\n30s — RM 0.90 (full mini-film)",
            tip:
              "8-12s sweet spot untuk hero video landing page. 15s+ jarang convert better untuk social — orang scroll.",
          },
          {
            title: "Dropdown 'SIZE' — aspect ratio",
            description:
              "9:16 (vertical) — TikTok / Reels / Shorts.\n\n16:9 (horizontal) — YouTube / Facebook / desktop landing page.\n\n1:1 (square) — Instagram feed legacy.\n\nGrok Imagine native support semua aspect — pick ikut platform.",
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
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Dropdown 'ASPECT RATIO'",
            description:
              "9:16 (Portrait) — TikTok / Reels (default).\n\n16:9 (Landscape) — YouTube / Facebook.\n\n1:1 (Square) — Instagram feed.\n\n3:4 / 4:3 — half-portrait / half-landscape, niche use.\n\n21:9 (Cinemascope) — ultra-wide cinema look untuk premium hero shots.",
            tip:
              "21:9 paling cinematic tapi crop untuk TikTok. 9:16 default untuk social.",
          },
          {
            title: "Slider 'DURATION' — 4 to 15 saat",
            description:
              "Seedance support 4–15 saat. Default 8 saat. Cost RM 0.40 per saat (admin tunable).\n\n4s — RM 1.60 (paling murah)\n8s — RM 3.20 (sweet spot)\n15s — RM 6.00 (max, full scene)\n\nCost calculator update real-time bila slider drag.",
            tip:
              "Seedance 8 saat sweet spot — long enough for action sequence, short enough untuk TikTok scroll-stopping. 15s untuk extended narrative.",
          },
          {
            title: "Reference Images Slot (max 4)",
            description:
              "+ button add reference image. Upload sampai 4 gambar:\n\n[Image1] — biasanya character / face anchor\n[Image2] — second character atau scene element\n[Image3] — environment / background\n[Image4] — additional asset\n\nDalam prompt, refer guna [Image1], [Image2], dll. Seedance fuse semua jadi coherent video.",
            tip:
              "Pakai reference untuk consistent character merentasi multiple shots. 1 selfie sebagai [Image1] — Seedance kekalkan muka tu sepanjang video.",
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
      {
        heading: "Dropdown & Pilihan — Apa Maksud Setiap Satu",
        steps: [
          {
            title: "Dropdown 'OUTPUT' — 3 pilihan",
            description:
              "UGC (default) — generate prompt untuk Veo 3.1 8s/16s. Output structured untuk character speaking + dialog. Paste dalam UGC tab.\n\nCinema — generate Seedance 2.0 prompt. Output untuk multi-reference action sequences. Paste dalam Cinema tab.\n\nStory — generate Grok Imagine prompt. Output untuk pure cinematic visuals. Paste dalam Story tab.",
            tip:
              "Pick output ikut destination tab. Kalau reference video TikTok review, biasanya UGC. Kalau cinematic ad, Cinema atau Story.",
          },
          {
            title: "Dropdown 'SIZE' — aspect ratio",
            description:
              "9:16 (default) — vertical TikTok format. Output prompt akan dah include aspect ratio lock.\n\n16:9 — horizontal Facebook / YouTube. Tukar bila reference video originally horizontal.",
          },
          {
            title: "Field 'DIALOG' — optional override",
            description:
              "Kalau kosong: AI follow reference video dialog exactly (transcribe + adapt).\n\nKalau diisi: AI replace dialog with korang punya. Format dengan timestamps untuk timing exact:\n\n0s-4s Hook line\n4s-8s Value/proof\n8s-12s Build-up\n12s-16s CTA tekan beg kuning",
            tip:
              "Override dialog wajib kalau produk korang berbeza dari reference. Skeleton dari reference (timing + structure), content dari korang.",
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
      {
        heading: "Detail — Apa Maksud Setiap Field",
        steps: [
          {
            title: "Field 'CURRENT PLAN'",
            description:
              "Pro Plan — RM 75 / bulan. Unlocks semua tab generation (Image / UGC / Auto Content / Story / Cinema / Clone). Includes baseline credit balance bulanan.\n\nKalau plan inactive (lapse), button generate akan locked dan redirect ke Billing.",
          },
          {
            title: "Field 'RENEWAL'",
            description:
              "Date next auto-charge dari Chip. Auto-renew unless korang cancel. Tarikh = same day next month dari sign-up.\n\nContoh: sign-up 27 Apr, renewal next 27 May.",
            tip:
              "Notification 3 hari sebelum renewal via email + WhatsApp.",
          },
          {
            title: "Field 'STATUS'",
            description:
              "Active (green dot) — plan aktif, semua tab unlocked.\n\nInactive (red dot) — plan lapsed atau cancelled. Tab generation locked sampai renew.",
          },
          {
            title: "Field 'RATES' — per-asset cost",
            description:
              "Image — RM 0.20 per generation (Banana Pro / GPT Image / Imagen).\n\nVideo 8s — RM 0.40 per Veo 3.1 Fast generation.\n\nDeducted dari credit balance setiap generation. Pro plan include initial credits, top up via Top Up Credit page.",
          },
          {
            title: "Payment History columns",
            description:
              "DATE — when transaction happened.\n\nDESCRIPTION — Pro Plan / PRO atau Top Up X credits.\n\nAMOUNT — RM amount paid.\n\nSTATUS — Success (paid OK), Pending (processing), Failed (payment error).",
            tip:
              "Failed status: tekan 'Check' button untuk re-trigger Chip retry. Kalau still fail, contact admin via WhatsApp.",
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
      {
        heading: "Detail — Apa Maksud Setiap Card",
        steps: [
          {
            title: "Card 'CREDIT BALANCE'",
            description:
              "Number of credits remaining dalam akaun korang. 1 credit = RM 1 worth of generation. Setiap generation deduct credits ikut rate (image RM 0.20, video 8s RM 0.40, dll).",
          },
          {
            title: "Card 'IMAGE GENERATE / VIDEO 8S / AUTO CONTENT'",
            description:
              "Estimate berapa generation boleh buat dengan current balance:\n\n• Image Generate ~132 — kalau balance RM 26.45 ÷ RM 0.20 = 132 images\n• Video 8s ~66 — RM 26.45 ÷ RM 0.40 = 66 videos\n• Auto Content (10 video pack) ~6 — RM 26.45 ÷ RM 4.10 (master plan + 10 videos) = 6 batches",
            tip:
              "Estimate ni guide sahaja — actual cost vary kalau pakai Imagen 4 (lebih mahal) atau Seedance (lebih mahal lagi).",
          },
          {
            title: "Credit Packages",
            description:
              "10 CREDITS — RM 10 (Starter pack) — try it out, sufficient untuk ~50 images atau ~25 videos.\n\n20 CREDITS — RM 20 (Try it out)\n\n30 CREDITS — RM 30 (Common) — popular pick.\n\n50 CREDITS — RM 50 (BEST VALUE) — sweet spot. ~250 images / ~125 videos. Last 2 weeks regular usage.\n\n100 CREDITS — RM 100 (Power user) — bulk discount feel, untuk agency / pro user.",
            tip:
              "50 credits paling popular — best ratio price-to-usage.",
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
      {
        heading: "Detail — Apa Maksud Setiap Column",
        steps: [
          {
            title: "Column 'ACTION'",
            description:
              "Apa benda yang generated:\n• Video 8s generated — UGC tab Veo generation\n• Image generated — Image tab\n• seedance — Cinema tab Seedance generation\n• Cinema video generated — Story tab Grok generation\n• Auto plan batch — Auto Content full batch\n\nBadge selepas action name = provider (P1 = GeminiGen, P2 = Crun.ai).",
          },
          {
            title: "Column 'PROMPT'",
            description:
              "Excerpt dari prompt yang dipakai (max ~50 char). Click row untuk full prompt detail.",
          },
          {
            title: "Column 'PREVIEW'",
            description:
              "Mini badge type (Video / Image / Auto). Click untuk preview output dalam modal.",
          },
          {
            title: "Column 'CREDIT' (negative number, red)",
            description:
              "Berapa credit deducted untuk transaction ni. Negative red = deducted. Positive green (kalau ada) = top-up / refund.",
          },
          {
            title: "Column 'BALANCE' (running total)",
            description:
              "Credit balance lepas transaction ni. Useful untuk trace bila balance drop drastically.\n\nKalau lihat balance pernah tinggi tapi sekarang kosong, scroll ikut date untuk find heaviest spend.",
            tip:
              "Pakai filter pills (All / Image / Video / Auto / Clone / Post) + date range untuk narrow ke specific spend pattern.",
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
      {
        heading: "Detail — Apa Maksud Setiap Filter & Element",
        steps: [
          {
            title: "Filter Pills — All / UGC Plan / Cinema Plan / Auto Plan",
            description:
              "All (default) — semua prompts.\n\nUGC Plan — prompts dari UGC tab (Veo 3.1 single videos).\n\nCinema Plan — prompts dari Cinema (Seedance) atau Story (Grok) tabs.\n\nAuto Plan — prompts dari Auto Content batches (master plan + multiple videos).\n\nFilter membantu narrow library bila dah ramai prompts.",
          },
          {
            title: "Dropdown 'All projects'",
            description:
              "Pilih project specific untuk filter — atau biar 'All projects' untuk merentasi semua project.\n\nUseful kalau korang ada banyak client / banyak campaign masing-masing dalam project sendiri.",
          },
          {
            title: "Toggle 'STARRED ONLY'",
            description:
              "Tick — show only starred prompts (favorites).\n\nUntick (default) — show all.\n\nGuna untuk akses cepat ke 'best of' library yang dah curated.",
            tip:
              "Maintain ~10-20 starred prompts sebagai 'go-to' template library — copy paste ikut occasion.",
          },
          {
            title: "Refresh icon (↻)",
            description:
              "Re-fetch dari database. Useful kalau baru-baru generate dan tak nampak yet (auto-refresh dalam ~10 saat tapi kadang lambat).",
          },
          {
            title: "Card Header — UGC PLAN / 1 VARIANTS / 8s",
            description:
              "Plan type badge (color-coded):\n• AUTO PLAN (orange) — auto-content batch\n• UGC PLAN (green) — single UGC\n• CINEMA PLAN (purple) — Cinema/Story\n\nVariants count — berapa video dalam plan tu.\n\nDuration — 8s atau 16s.",
          },
          {
            title: "Card Body Content",
            description:
              "Numbered breakdown setiap variant dalam plan tu:\n\n1. [scene-id] persona-id · hook=hook-id · framework=fw-id · voice=voice-id\n\nClick card untuk preview full prompt body. COPY untuk paste dalam tab generate.",
            tip:
              "Element nama bracket [...] adalah skill IDs dari skill library. Saved untuk korang re-use struktur exact.",
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
      {
        heading: "Detail — Apa Maksud Setiap Card & Field",
        steps: [
          {
            title: "Card 'PROFILE' — Display Name + Email",
            description:
              "DISPLAY NAME — nama yang ditunjukkan dalam dashboard (e.g. 'Welcome back, <name>'). Boleh edit anytime.\n\nEMAIL — locked, tak boleh edit. Kalau salah email, hubungi admin via WhatsApp untuk tukar.",
          },
          {
            title: "Card 'WHATSAPP' — Phone Number",
            description:
              "Format international: +60123456789 (Malaysia +60).\n\nKegunaan:\n• Login OTP (one-time code via WhatsApp)\n• Support notification (admin reach out)\n• Password reset code\n• Renewal reminder 3 hari sebelum auto-charge\n\nTekan 'Save WhatsApp' untuk save.",
            tip:
              "Wajib set untuk password reset workflow. Tanpa WhatsApp, password lost = contact admin manually.",
          },
          {
            title: "Card 'VIDEO PROVIDER' — P2 Default / P1",
            description:
              "P2 (Default) — Crun.ai backend. Faster Veo Fast generation, paling stable.\n\nP1 — GeminiGen backend. Sometimes better untuk specific scene types. Pakai bila P2 output tak quality.\n\nApply HANYA untuk video baru — in-flight rows continue dengan provider asal.\n\nSetting per-user — tak override admin default untuk client lain.",
            tip:
              "Mostly stick dengan P2. Switch ke P1 kalau notice quality regression dari P2 (rare).",
          },
          {
            title: "Card 'CHANGE PASSWORD'",
            description:
              "OLD PASSWORD — current password korang.\n\nNEW PASSWORD — minimum 8 char.\n\nCONFIRM NEW — re-type new password (confirm typo).\n\nKlik 'Change Password' button. Lepas success, korang automatic logged out — re-login dengan password baru.",
            tip:
              "Lupa old password = tak boleh tukar dari sini. Kena reset via WhatsApp OTP — hubungi admin.",
          },
        ],
      },
    ],
    closing:
      "Email locked (kena admin tukar). Display name + WhatsApp + provider + password — boleh edit sendiri. Settings auto-save except password (kena confirm).",
  },
};
