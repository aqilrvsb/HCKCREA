// SOP (Standard Operating Procedure) content for the dashboard pages.
// One entry per page-key. The SopButton picks the matching entry based
// on the active dashboard view / tab and renders SopModal with it.
//
// Tone: casual Malaysian-Malay mix ("korang", "aku", "ni", "tu",
// "memang", "gila") with English tech terms left in English ("AI
// agent", "frame", "history", "ingredient mode", "veo"). Matches the
// rest of the app's voice.
//
// Screenshots live under /public/sop/<page-key>/<step-N>.png. They're
// captured via Playwright at desktop width (1280x800) so the UI is
// spacious enough for tutorial use; the modal scales them responsively
// on mobile.

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
  // UGC tab — Manual UGC + AI Agent UGC (both share this tab)
  // ─────────────────────────────────────────────────────────────────
  ugc: {
    pageKey: "ugc",
    title: "Tab UGC — Generate Video Selfie Style",
    subtitle: "Veo 3.1 Fast · 8 saat · vertical 9:16",
    intro:
      "Tab UGC untuk korang generate video gaya selfie / handheld — macam orang real review produk dalam Bahasa Melayu. Avatar kat kamera, pegang produk, cakap dialog yang korang tulis. Sesuai untuk affiliate / TikTok Shop content.",
    whenToUse:
      "Bila korang nak SATU video UGC sahaja dengan dialog specific yang korang dah ada idea. Kalau nak banyak video sekali gus dengan AI plan, gunaTab Auto Content. Kalau nak chat dengan AI untuk bantu draft, scroll bawah ada AI Agent UGC.",
    sections: [
      {
        heading: "Cara guna Manual UGC (form atas)",
        steps: [
          {
            title: "Step 1 — Form UGC overview",
            image: "/sop/ugc/step-1-form-overview.png",
            imageAlt: "Full UGC form: Video Generator, Scene, Size, Generate UGC",
            description:
              "Ni semua bahagian yang korang akan isi. Video Generator (atas) — pilih duration (8s) + Image Mode. Scene (tengah) — upload gambar produk + tulis dialog/prompt + tekan Prompt Builder kalau stuck. Size (bawah) — biasa 9:16 untuk TikTok. Generate UGC — fire button hijau besar.",
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
};
