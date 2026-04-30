// Auto Content frameworks — verbatim port of creative-hack-auto 12.8.3
// background.js FRAMEWORKS array + studio.js FRAMEWORK_LIST display rows.
// Each framework gives the master planner a different "angle" so a batch
// of N videos hits N distinct creative directions instead of N variations
// of the same hook.

export type FrameworkType = "ugc" | "product" | "lifestyle";

export type Framework = {
  id: number;
  name: string;
  short: string;          // 3-4 char chip label shown next to checkbox
  type: FrameworkType;    // drives chip color + persona/character logic
  needsCharacterImage: boolean;
  focus: string;          // one-line description of the angle
  shot1: string;          // shot 1 (0-8s) creative direction
  shot2: string;          // shot 2 (8-16s, only if duration=16) — can mirror as CTA for 8s
  emotion: string;        // arc tag, "none" for product-only frames
  ctaStyle: string;       // fallback CTA when shopMode=false
  strictUsp?: boolean;    // when true: dialog/caption MUST stay narrow to user's product info, no drift
  handPov?: boolean;      // when true: hand-only POV — hand visible holding product, NO face/body, luxury vehicle bg
  strategy: {
    purpose: string;      // why this framework exists, what problem it solves
    bestFor: string;      // when to use — product types / scenarios
    avoidWhen: string;    // when NOT to use — don't waste this slot on the wrong product
    psychology: string;   // why it works on the audience emotionally
    dialogShape: string;  // shape of the dialog — opening / middle / close
    example: string;      // sample one-liner dialog (Malay, casual)
  };
};

export const FRAMEWORKS: Framework[] = [
  {
    id: 0,
    name: "Hook + Pain (PAS)",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Grab attention with problem, agitate, solve",
    shot1: "Hook question addressing pain point. Use \"Korang tau tak...\", \"Penat tak...\", \"Masalah ni biasa kan...\"",
    shot2: "Present product as THE solution, show relief",
    emotion: "frustrated → relieved → happy",
    ctaStyle: "Order sekarang, stok terhad!",
    strategy: {
      purpose: "Pakai PAS formula — Problem, Agitate, Solve. Mula tarik perhatian dengan masalah yang penonton memang ada, agitate (buat dia rasa benda tu memang teruk), pastu present produk sebagai solution.",
      bestFor: "Produk yang ada CLEAR pain point — sakit, gatal, malu, frustrasi. Contoh: cream untuk kulit kusam, deodoran untuk bau, supplement untuk badan kurus.",
      avoidWhen: "Kalau produk tak ada specific pain (e.g., aksesori cantik, makanan ringan) — pain hook akan rasa fake/forced.",
      psychology: "Manusia lebih reactive kepada AVOID PAIN dari SEEK PLEASURE. Hook dengan masalah dia recognize → instant attention.",
      dialogShape: "Opening: pain question (\"Penat tak X?\") → Middle: agitate the pain (sebab apa benda ni teruk) → Close: product as solution + CTA.",
      example: "\"Penat tak ketiak melekit dalam panas Malaysia? Aku pun macam tu sampai jumpa Sambal X — sekali pakai memang setel...\"",
    },
  },
  {
    id: 1,
    name: "Product Hero (AIDA)",
    short: "PRD",
    type: "product",
    needsCharacterImage: false,
    focus: "Cinematic product showcase, let product speak",
    shot1: "Dramatic reveal of product on elegant surface, slow rotation, highlight packaging details",
    shot2: "Close-up of product features, texture, label details with dramatic lighting shift",
    emotion: "none",
    ctaStyle: "Dapatkan sekarang!",
    strategy: {
      purpose: "Showcase product macam advertisement premium — letak dia atas pedestal, light dia cinematic, biar packaging speak for itself. Voiceover je, no person on screen.",
      bestFor: "Produk yang packaging dia cantik — beauty, fragrance, tech, premium food. Brand yang nak project quality.",
      avoidWhen: "Packaging biasa atau produk yang user tak nampak (digital, service). Tak da visual untuk hero.",
      psychology: "Premium aesthetic = perceived quality. Slow cinematic shots trigger \"high-end\" mental category — penonton ingat brand premium.",
      dialogShape: "Voiceover only. Opening: brand intro/promise. Middle: feature highlight. Close: CTA.",
      example: "Voiceover: \"Sambal X — premium dari Pahang. Pedas authentic, kualiti terjamin.\"",
    },
  },
  {
    id: 2,
    name: "Testimonial",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Personal story and social proof",
    shot1: "Share personal struggle/story before finding product. Use \"Dulu saya pun macam korang...\", \"Mula-mula saya tak percaya...\"",
    shot2: "Show transformation/result after using product, genuine excitement",
    emotion: "doubtful → amazed → grateful",
    ctaStyle: "Cuba sendiri, memang berbaloi!",
    strategy: {
      purpose: "Personal story — character share dia punya journey before/after pakai produk. Bina trust through relatability.",
      bestFor: "Produk yang ada visible result lepas guna — supplement, skincare, weight management. Audience nak hear from real person.",
      avoidWhen: "Produk yang result tak observable atau belum cukup data untuk testimonial (e.g., produk baru launch).",
      psychology: "Social proof — kalau orang lain dah berjaya, aku pun boleh. Stories beats facts in persuasion.",
      dialogShape: "Opening: doubt/struggle (\"Mula-mula aku tak percaya...\") → Middle: turning point (jumpa produk) → Close: result + recommendation.",
      example: "\"Dulu BMI aku tak stable, makan banyak tapi badan tak naik. Lepas guna S-Ninety 2 minggu, baru aku rasa bezanya...\"",
    },
  },
  {
    id: 3,
    name: "Soft Sell (HSO)",
    short: "LIFE",
    type: "lifestyle",
    needsCharacterImage: false,
    focus: "Aspirational scene, product naturally placed in beautiful setting",
    shot1: "Aesthetic morning/lifestyle scene — cozy setting, warm tones, product visible but not center focus",
    shot2: "Closer interaction with product in the scene, aspirational lifestyle moment",
    emotion: "none",
    ctaStyle: "Link kat bio!",
    strategy: {
      purpose: "HSO = Hook, Story, Offer dalam aesthetic packaging. Bukan hard sell — produk muncul natural dalam scene cantik macam Pinterest. Target audience yang skip ads tapi engage dengan vibes.",
      bestFor: "Produk yang fit lifestyle aesthetic — coffee, candles, skincare, fashion. Audience yang appreciate slow + beautiful.",
      avoidWhen: "Produk functional/utility (cleaning supplies, supplements). Lifestyle scene tak match.",
      psychology: "Manusia nak BE the person dalam scene tu. Produk jadi attribute of that life — beli produk = beli the lifestyle.",
      dialogShape: "Voiceover lembut, slow pace. Opening: scene-setting. Middle: produk slot in naturally. Close: subtle CTA.",
      example: "Voiceover: \"Pagi ahad. Kopi panas. Sambal X kat dapur — ready untuk lunch family hari ni.\"",
    },
  },
  {
    id: 4,
    name: "FOMO/Urgency",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Limited stock, fear of missing out, urgency",
    shot1: "Excited unboxing or holding product, convey scarcity. Use \"Stok tinggal sikit je!\", \"Last batch ni!\"",
    shot2: "Show product benefits quickly, create urgency to buy NOW",
    emotion: "excited → urgent → persuasive",
    ctaStyle: "Cepat grab sebelum habis!",
    strategy: {
      purpose: "Trigger FOMO (Fear Of Missing Out). Highlight stok terhad / limited time / viral status. Push penonton buat decision SEKARANG, bukan \"nanti la\".",
      bestFor: "Produk dalam masa promo, limited edition, viral momentum. Bila supply memang limited atau audience boleh check stock secara real.",
      avoidWhen: "Stok memang banyak — fake urgency cheap dan trust-killing. Audience nampak.",
      psychology: "Loss aversion — manusia takut kehilangan lebih besar dari excited mendapat. \"Nanti tak ada\" lebih kuat dari \"ada sekarang\".",
      dialogShape: "High-energy delivery. Opening: scarcity hook. Middle: quick benefit (kenapa cepat grab). Close: urgent CTA.",
      example: "\"Eh stok tinggal 50 je! Sambal X yang viral tu — restock next month. Cepat grab sekarang!\"",
    },
  },
  {
    id: 5,
    name: "Before/After",
    short: "PRD",
    type: "product",
    needsCharacterImage: false,
    focus: "Transformation showcase, visual comparison",
    shot1: "Show the \"before\" state — plain, dull, problem visible. Product enters frame dramatically",
    shot2: "Reveal the \"after\" transformation — clean, improved, product prominently displayed with results",
    emotion: "none",
    ctaStyle: "Tengok perbezaan tu!",
    strategy: {
      purpose: "Visual proof of transformation. Split-screen atau time-jump dari \"before\" (problem visible) ke \"after\" (problem solved). Show, don't tell.",
      bestFor: "Produk yang result dia VISIBLE — cleaning, beauty, fitness, organization. Audience boleh nampak difference.",
      avoidWhen: "Result invisible (vitamin, mental health, taste). Tak ada \"after\" untuk show.",
      psychology: "Visual evidence beats verbal claims. Brain process visual transformation 60,000x faster than text. Convincing tanpa explain.",
      dialogShape: "Voiceover or no dialog. Opening: \"before\" frame. Middle: product transition. Close: \"after\" reveal + CTA.",
      example: "Voiceover: \"Lantai berdaki — 30 saat dengan Sambal X — bersih kilat.\"",
    },
  },
  {
    id: 6,
    name: "BAB (Before-After-Bridge)",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Story arc — before struggle, after success, bridge is the product",
    shot1: "Tell the \"before\" story — the struggle, the frustration. Use \"Sebelum ni saya...\" with genuine emotion",
    shot2: "Show the \"after\" — how product changed everything, bridge the gap",
    emotion: "sad → hopeful → joyful",
    ctaStyle: "Jom cuba, takkan rugi!",
    strategy: {
      purpose: "Macam Testimonial tapi structured — Before (struggle), After (success), Bridge (produk yang connect both). Storytelling masuk dalam 8s.",
      bestFor: "Produk yang ada \"life-changing\" angle — supplement, course, beauty regimen. Story-driven products.",
      avoidWhen: "Produk routine/everyday (snacks, household). Storytelling overkill.",
      psychology: "Narrative transportation — bila penonton imagine character's journey, otak dia treat as personal experience. Trust naik.",
      dialogShape: "Opening: low-point (\"Sebelum ni aku...\") → Middle: turning point (jumpa produk) → Close: high-point (sekarang aku...).",
      example: "\"Sebelum ni aku selalu malu nak angkat tangan sebab bau ketiak. Lepas guna Sambal X — confidence balik.\"",
    },
  },
  {
    id: 7,
    name: "4Ps (Promise-Picture-Proof-Push)",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Structured sell — promise, paint picture, show proof, push action",
    shot1: "Make a bold promise, paint vivid picture of results. Use \"Saya janji...\", \"Bayangkan...\"",
    shot2: "Show proof (results, reviews mention), then strong push to buy",
    emotion: "confident → vivid → convincing",
    ctaStyle: "Dah terbukti berkesan!",
    strategy: {
      purpose: "Classic copywriting formula compress dalam 8s. Promise (claim) → Picture (visualization) → Proof (evidence) → Push (CTA). High-conversion structured pitch.",
      bestFor: "Produk dengan strong claims yang ada bukti — supplement, course, gadget. Audience yang skeptical, perlu proof points.",
      avoidWhen: "Produk lifestyle/aesthetic. Structured sell rasa terlalu \"agresif\" untuk vibes content.",
      psychology: "Cover semua phase of decision-making dalam satu video — interest, desire, trust, action. High-density persuasion.",
      dialogShape: "Opening: promise (\"Aku janji korang...\") → Middle: picture+proof (bayangkan + 1 fact) → Close: push CTA.",
      example: "\"Aku janji — 7 hari guna Sambal X korang akan rasa beza. Aku dah test sendiri. Cuba la.\"",
    },
  },
  {
    id: 8,
    name: "USP Showcase",
    short: "PRD",
    type: "product",
    needsCharacterImage: false,
    focus: "Ingredients, certification, unique features close-up",
    shot1: "Extreme close-up of product label, ingredients list, certification marks. Slow pan across details",
    shot2: "Show unique selling points — texture, consistency, special features with macro-style shots",
    emotion: "none",
    ctaStyle: "Kualiti terjamin!",
    strategy: {
      purpose: "VISUAL showcase USP — extreme close-up label, ingredients, halal cert, texture, packaging detail. Voiceover bagi context. No person.",
      bestFor: "Produk yang USP visible (label, packaging detail, ingredient list). Halal cert, organic, premium materials.",
      avoidWhen: "USP intangible (taste, feel, energy). Visual close-up tak deliver value.",
      psychology: "Detail = quality. Macro shots trigger \"premium\" + \"science-backed\" perception. Cert visuals build instant trust.",
      dialogShape: "Voiceover berdialog dengan visual. Opening: USP claim. Middle: visual proof (close-up). Close: trust statement + CTA.",
      example: "Voiceover: \"Halal certified. Bahan asli dari Pahang. Tiada pengawet — itu Sambal X.\"",
    },
  },
  {
    id: 9,
    name: "Action Bias",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Direct hard sell, no fluff, straight to point",
    shot1: "Straight to camera, hold product up, state what it does bluntly. Use \"Tak payah pikir panjang!\", \"Benda ni memang power!\"",
    shot2: "Demonstrate product quickly, direct hard CTA with urgency",
    emotion: "bold → assertive → commanding",
    ctaStyle: "Tekan sekarang, jangan tangguh!",
    strategy: {
      purpose: "Bypass overthinking — direct + commanding tone, no soft persuasion. \"Beli je, jangan fikir.\" High-confidence delivery yang feels like recommendation from kawan yang serious.",
      bestFor: "Audience yang dah aware (low price-point, impulse buy). Produk simple yang tak perlu deep explanation.",
      avoidWhen: "High-ticket product yang perlu trust building. Hard sell kepada cold audience = block.",
      psychology: "Decisiveness signals expertise. Bila someone bagi command tone confident, otak tend to comply. Reduce decision fatigue.",
      dialogShape: "Bold delivery. Opening: command (\"Tak payah pikir!\"). Middle: 1 reason. Close: urgent CTA.",
      example: "\"Dengar sini — Sambal X tu memang power, tak payah pikir panjang. Tekan beg kuning sekarang.\"",
    },
  },
  {
    id: 10,
    name: "Solution Focus",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Explain how product solves specific problem step by step",
    shot1: "Identify the specific problem clearly. Use \"Ada masalah [X]?\", \"Kalau korang struggle dengan [X]...\"",
    shot2: "Show step-by-step how product solves it, clear explanation",
    emotion: "empathetic → knowledgeable → helpful",
    ctaStyle: "Masalah selesai, klik bawah!",
    strategy: {
      purpose: "Diagnose problem dulu, then walk through HOW produk solve dia step-by-step. Educational tone — teacher mode bukan sales mode.",
      bestFor: "Produk dengan multi-step usage atau complex benefit (skincare routine, supplement protocol, software). Audience yang nak faham dulu sebelum beli.",
      avoidWhen: "Simple product (snacks, accessories). Over-explaining bila tak perlu.",
      psychology: "Helpful = trustworthy. Teaching mode build authority. Audience treat creator as advisor, bukan salesperson.",
      dialogShape: "Opening: identify problem. Middle: how-it-works (1-2 step). Close: outcome + CTA.",
      example: "\"Kulit kusam? Step 1 — apply Sambal X malam. Step 2 — bangun, kulit refresh. Itu je.\"",
    },
  },
  {
    id: 11,
    name: "Flat Lay / Aesthetic",
    short: "PRD",
    type: "product",
    needsCharacterImage: false,
    focus: "Artistic product display, top-down or arranged composition",
    shot1: "Beautiful flat lay arrangement — product with complementary props, overhead shot, aesthetic composition",
    shot2: "Gentle hand enters to pick up product, showing scale and texture, maintaining aesthetic mood",
    emotion: "none",
    ctaStyle: "Cantik kan? Dapatkan sekarang!",
    strategy: {
      purpose: "Aesthetic-driven content macam Instagram flat-lay. Top-down composition, props complementary, slow pan/zoom. Build brand desire through beauty.",
      bestFor: "Visually photogenic products — beauty, fashion, food, books. Brands building \"premium aesthetic\" image.",
      avoidWhen: "Bulky/utility products (cleaning supplies, electronics). Flat lay tak suit.",
      psychology: "Aesthetic = elevated brand. Beauty triggers desire faster than features. Audience save/share content cantik.",
      dialogShape: "Voiceover minimum. Opening: aesthetic moment. Middle: product as hero of arrangement. Close: gentle CTA.",
      example: "Voiceover: \"Sunday morning. Sambal X dengan kuih raya — Malaysia di hujung jari.\"",
    },
  },
  {
    id: 12,
    name: "Benefit + Result",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Show transformation after using product",
    shot1: "Hold product, list key benefits enthusiastically. Use \"3 sebab kenapa saya suka...\", \"Benefit dia...\"",
    shot2: "Show visible results/transformation, genuine reaction to results",
    emotion: "enthusiastic → impressed → delighted",
    ctaStyle: "Nak result macam ni? Grab sekarang!",
    strategy: {
      purpose: "Listicle hook (\"3 reasons aku suka...\") + visible transformation. Pacing cepat untuk fit listicle dalam 8s. Audience love structured info.",
      bestFor: "Produk multi-benefit (3+ USPs). Skincare, supplement, multi-feature gadgets.",
      avoidWhen: "Single-USP product (one-trick pony). Listicle rasa stretched.",
      psychology: "Numbered lists = perceived complete information. \"3 reasons\" feels comprehensive. Brain love structure.",
      dialogShape: "Opening: \"3 sebab aku suka...\" → Middle: rapid-fire 3 benefits → Close: result reveal + CTA.",
      example: "\"3 sebab aku suka Sambal X — pedas authentic, halal cert, harga reasonable. Korang try la.\"",
    },
  },
  {
    id: 13,
    name: "Evening Routine",
    short: "LIFE",
    type: "lifestyle",
    needsCharacterImage: false,
    focus: "Product as part of daily evening/night routine",
    shot1: "Cozy evening scene — warm lighting, relaxed atmosphere, product naturally visible on table/counter",
    shot2: "Product being used as natural part of routine, calming aesthetic mood",
    emotion: "none",
    ctaStyle: "Wajib ada dalam routine!",
    strategy: {
      purpose: "Position produk sebagai part of habit yang penonton dah ada (evening wind-down). Build assumption: kalau tak ada produk ni dalam routine = routine incomplete.",
      bestFor: "Produk untuk repeat usage — skincare, supplement, drinks, candles. Anything yang fit \"daily ritual\" framing.",
      avoidWhen: "One-time purchase (gadget besar, furniture). Tak fit routine angle.",
      psychology: "Habit anchoring — kalau penonton already ada evening routine, produk yang muncul dalam scene routine tu masuk dalam mental \"things in my routine\" category.",
      dialogShape: "Voiceover slow + cozy. Opening: scene-setting (warm lighting). Middle: produk slot in. Close: routine completion vibe.",
      example: "Voiceover: \"9 malam. Lampu kuning. Sambal X dengan secangkir teh — itu routine aku.\"",
    },
  },
  {
    id: 14,
    name: "Fear of Loss",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Consequences of NOT using the product",
    shot1: "Paint scary picture of what happens WITHOUT the product. Use \"Tau tak apa jadi kalau...\", \"Ramai tak sedar...\"",
    shot2: "Present product as protection/prevention, relief from fear",
    emotion: "worried → scared → relieved",
    ctaStyle: "Jangan sampai menyesal!",
    strategy: {
      purpose: "Reverse-angle dari Pain — focus pada CONSEQUENCE of NOT having produk. Paint future scenario yang menakutkan. Produk = protection/insurance.",
      bestFor: "Preventive products — supplements (kesihatan jangka panjang), security, insurance, skincare anti-aging.",
      avoidWhen: "Indulgence products (makanan, hiburan). Fear angle tak fit.",
      psychology: "Loss aversion 2x stronger than gain seeking. Painting loss scenario more motivating than benefit promise.",
      dialogShape: "Opening: scary scenario question. Middle: agitate the consequence. Close: produk as protection + CTA.",
      example: "\"Tau tak apa jadi bila terus skip vitamin? 5 tahun lagi sesal. Sambal X bantu protect, mulakan sekarang.\"",
    },
  },
  // ─────────────────────────────────────────────────────────────────
  // STRICT USP FRAMEWORKS — zero drift, dialog/caption/prompts MUST
  // bind to the user-provided product info. AI cannot invent benefits,
  // ingredients, percentages, timeframes, or personal stories that
  // aren't directly traceable to <product_data>. Use these when the
  // client gives clear product details and you want REAL accuracy
  // over creative storytelling.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 15,
    name: "UGC USP (Strict)",
    short: "UGC",
    type: "ugc",
    needsCharacterImage: true,
    focus: "Strictly narrow to product info — character explains ONE specific USP from user input",
    shot1: "Character on screen, holds product, opens with the EXACT pain/USP user provided. Use direct phrasing from product info — no invention.",
    shot2: "Character lists the actual benefit + product name + CTA. Every claim traceable to <product_data>. No fabricated stories.",
    emotion: "honest → direct → trustworthy",
    ctaStyle: "Try sekarang, real benefit!",
    strictUsp: true,
    strategy: {
      purpose: "🚨 STRICT MODE — UGC video yang STRICTLY narrow to user's product info. AI tak boleh invent benefits, numbers, ingredients, atau personal stories yang takde dalam <product_data>. Setiap line dialog mesti tied to actual USP user provide.",
      bestFor: "Bila client bagi clear product info dengan specific USPs (e.g., \"tambah selera makan, percepat otot, BMI stabil\"). Lagi accurate dari fluffy storytelling.",
      avoidWhen: "Product info terlalu vague atau cuma name + price. Tak cukup material untuk narrow content.",
      psychology: "Authentic > polished. Audience trust factual claims over salesy storytelling. Real benefit + real USP = real conversions.",
      dialogShape: "Opening: state the EXACT pain/USP from product info (no rewording). Middle: how the product addresses it (still narrow). Close: direct CTA with product name.",
      example: "\"Korang yang makan banyak tapi badan tak naik — ni masalah aku dulu. S-Ninety bantu tambah selera makan. Try la.\"",
    },
  },
  {
    id: 16,
    name: "Product USP (Strict)",
    short: "PRD",
    type: "product",
    needsCharacterImage: false,
    focus: "Strictly narrow to product info — voiceover states ONE specific USP, no person on screen",
    shot1: "Cinematic product close-up. Voiceover quotes the EXACT USP from user's product info. No invention.",
    shot2: "Continued product showcase with voiceover stating the actual benefit/feature. Every claim from <product_data>.",
    emotion: "none",
    ctaStyle: "USP terbukti, dapatkan sekarang!",
    strictUsp: true,
    strategy: {
      purpose: "🚨 STRICT MODE — Product-only video (no person) dengan voiceover yang STRICTLY narrow to user's product info. Macam premium ad tapi factually grounded.",
      bestFor: "Brand premium yang ada specific USPs documented (halal cert, ingredient list, lab results). Clinical accuracy beats creative drift.",
      avoidWhen: "Lifestyle/aesthetic-driven products. Strict mode rasa terlalu \"clinical\" untuk vibes brands.",
      psychology: "Premium aesthetic + factual claims = high-trust conversion. Audience sophisticated lebih percaya specific facts dari generic praise.",
      dialogShape: "Voiceover only. Opening: product name + main USP from product info. Middle: 1-2 specific facts (also from product info). Close: CTA.",
      example: "Voiceover: \"S-Ninety — tambah selera makan, bantu BMI stabil. Formulated untuk Malaysia.\"",
    },
  },
  // ─────────────────────────────────────────────────────────────────
  // HAND-POV FRAMEWORK — single hand holding product against rotating
  // luxury vehicle interiors. NO face, NO body. The "wow" comes from
  // the aspirational background (Lamborghini / Mercedes / Ferrari /
  // etc.) creating implicit "if you buy this, you live this life".
  // Product gently shakes/rotates to draw the eye. Voiceover sells.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 17,
    name: "PROD Goyang2 (Hand POV)",
    short: "POV",
    type: "product",
    needsCharacterImage: false,
    handPov: true,
    focus: "Hand-only POV holding product, gentle shake animation, rotating authentic scroll-stopping background",
    shot1: "Extreme close-up — single female hand (modest, light skin, simple manicure, NO face/body/arm-above-wrist visible) holding the product firmly with label facing camera. Product gently shakes/sways back-and-forth in slow casual rhythm (5-10° tilts). Background: ROTATE through authentic scroll-stopping settings (luxury vehicle interior / regular Malaysian car / aesthetic indoor cozy / retail store aisle / studio clean / outdoor lifestyle) — soft-focus bokeh behind product. Pick ONE setting per video, vary across batch for max variety.",
    shot2: "Continued hand-product hero framing. Slight angle shift / closer zoom to product label. Product rotation continues. Same background bokeh. Voiceover delivers CTA over the gentle motion.",
    emotion: "none",
    ctaStyle: "Tekan beg kuning, jangan lepas!",
    strategy: {
      purpose: "Selfie-POV close-up of hand holding product against ROTATING authentic backgrounds — luxury cars (Lambo/Mercedes), everyday Malaysian cars (Honda/Perodua), aesthetic indoor (curtain+plant), retail store aisles, cozy lifestyle scenes. Each video pakai different background = visual variety stops scroll. The background does emotional work; product hero stays consistent.",
      bestFor: "Any product (skincare, F&B, gadgets, accessories) yang user nak high-volume content output. Each video looks different (varied bg) but pattern is locked (hand+product+shake) — perfect for batch generation. Audience scrolls slow when background changes scene-to-scene.",
      avoidWhen: "Product yang dah ada own visual identity strong (brand campaigns, fashion editorial). PROD Goyang2 lebih untuk discovery + viral commerce, not brand-building.",
      psychology: "Pattern interrupt — viewer expects \"product ad\" but each scene background is unexpected (luxury car → store aisle → cozy bedroom). Background rotation feels like \"finds\" not \"ads\". Hand-only POV = relatable (could be viewer's own hand). Combined: stop-scroll + low-resistance entry to sales message.",
      dialogShape: "Voiceover (no on-screen speaker). Opening: viral hook 4-6 words. Middle: product benefit / USP 10-14 words. Close: CTA 4-6 words. Total 20-24 BM words.",
      example: "Voiceover: \"Dah viral kat FYP — Sambal X tu memang sedap gila. Tekan beg kuning sekarang.\"",
    },
  },
];

// List of authentic scroll-stopping backgrounds that PROD Goyang2 rotates
// through. Categories balance aspirational (luxury cars), relatable
// (regular cars), aesthetic (cozy indoor), discovery (retail store), and
// premium (studio). Mix-and-match to cover variety in any batch size.
export const HAND_POV_BACKGROUNDS: string[] = [
  // ── Luxury vehicles (wealth aspiration) ──
  "Lamborghini Urus interior — black leather dashboard, carbon fiber accents, premium steering wheel, ambient blue lighting",
  "Mercedes-Benz S-Class interior — beige Nappa leather, wood trim dashboard, illuminated star logo on steering, tasteful cabin",
  "Ferrari 488 GTB cockpit — racing-inspired dashboard, carbon fiber center console, prancing horse on red leather steering wheel",
  "Porsche 911 Turbo interior — black sport seats, carbon fiber dashboard, sport steering wheel, minimalist tachometer",
  "Bentley Continental GT interior — quilted diamond leather, polished wood veneer, opulent cabin atmosphere",
  "BMW M5 Competition interior — alcantara dashboard, M-sport steering wheel, red contrast stitching",
  // ── Everyday Malaysian cars (relatability) ──
  "Honda Civic FK7 interior — black sport dashboard, Honda H logo on steering wheel, manual gear shifter, daily driver feel",
  "Perodua Myvi interior — practical compact dashboard, Perodua emblem visible, Malaysian everyday vibe",
  "Toyota Vios interior — neat black dashboard, Toyota steering, urban commuter setting",
  // ── Aesthetic indoor (cozy/lifestyle) ──
  "Cozy bedroom corner — soft beige curtain, green leafy plant, warm afternoon golden light, minimalist Pinterest aesthetic",
  "Marble bathroom counter — subway tile bokeh, soft natural light through window, hand cream / skincare retail vibe",
  "Coffee shop wooden table — exposed brick wall bokeh, warm Edison bulb lighting, latte art saucer in soft focus",
  "Aesthetic vanity table — gold-framed mirror, dried pampas grass, soft pink wall, beauty creator vibe",
  // ── Retail / discovery context ──
  "Watsons skincare aisle — bright shelves with pastel skincare products in soft focus, retail discovery vibe",
  "Aeon supermarket beauty section — colorful product shelves bokeh, fluorescent retail lighting",
  "Korean cosmetics store — pastel pink shelves with K-beauty products, soft focus, viral retail look",
  // ── Studio / clean ──
  "Clean beige studio backdrop — soft diffused lighting, minimal shadow, Instagram-style flat composition",
  "White marble flat surface — soft natural sidelight, clean minimalist composition, premium product photo aesthetic",
  // ── Outdoor lifestyle ──
  "Beach cabana lounge — turquoise sea bokeh, golden sunset light, palm leaf shadow, vacation aspirational",
  "Rooftop infinity pool — city skyline bokeh, golden hour light, holiday luxury vibe",
  // ── Nature scenic (scroll-stop awe) ──
  "Tropical waterfall — lush jungle ferns and moss-covered rocks bokeh, mist rising, soft natural daylight, nature awe",
  "Mountain sunrise — misty alpine peaks in soft focus, warm golden first light spilling across ridges, dewy fresh air vibe",
  "Sunset beach silhouette — orange-pink horizon glow bokeh, gentle waves, palm tree silhouettes, end-of-day calm",
  "Cherry blossom park — soft pink petals falling bokeh, dappled spring light, romantic Japan aesthetic",
  "Misty pine forest — towering evergreens in fog bokeh, cool morning mist, soft diffused daylight, Pacific Northwest mood",
  "Lavender field — endless purple rows in soft focus, golden hour light, Provence countryside aesthetic",
  "Lake reflection at dawn — glassy water mirroring mountains bokeh, pastel pink-blue sky, serene morning calm",
  "Snow-capped peak overlook — alpine vista with crisp clean snow bokeh, blue-sky midday clarity, summit conquest vibe",
  "Tropical island infinity — turquoise lagoon and palm fronds bokeh, sun flare, paradise vacation feel",
  "Autumn forest path — golden-orange leaves bokeh, dappled afternoon sun rays through canopy, cosy fall mood",
  // ── Travel / experience contexts ──
  "Airplane window seat — cotton clouds and blue sky bokeh, soft natural diffused window light, jetset vibe",
  "Luxury hotel balcony — infinity ocean view bokeh, marble railing, golden sunrise spilling across, holiday luxury",
  "Yacht deck — open sea horizon bokeh, polished wood deck, golden hour Mediterranean glow, super-yacht aspirational",
  "Mountain cable car cabin — alpine peaks framed by window bokeh, soft daylight, adventure travel vibe",
  // ── Iconic beautiful destinations (scroll-stop awe) ──
  "Santorini white-and-blue cliffs — whitewashed Greek architecture and cobalt domes bokeh, Aegean Sea horizon, sunset golden hour",
  "Maldives overwater bungalow deck — turquoise lagoon bokeh, thatched roof villa, ladder into crystal water, paradise tropical",
  "Bali rice terraces — emerald green paddy field steps bokeh, palm trees, soft equatorial morning mist, Ubud aesthetic",
  "Mount Fuji with cherry blossoms — iconic snow-capped peak bokeh, pink sakura petals foreground, springtime Japan postcard",
  "Bamboo forest Arashiyama Kyoto — towering green bamboo grove bokeh, soft sunbeams piercing through, zen Japanese aesthetic",
  "Eiffel Tower from Trocadéro — iron lattice silhouette bokeh, Parisian cobblestones, golden sunset sky, romantic France",
  "Amalfi Coast cliffside — pastel Italian villas tumbling to sea bokeh, lemon trees, Mediterranean turquoise water, dolce vita",
  "Iceland glacier ice cave — translucent blue ice walls bokeh, soft cool daylight filtering through, otherworldly arctic",
  "Aurora borealis cabin — green northern lights dancing across sky bokeh, snow-covered log cabin, magical winter night",
  "Tulip fields Netherlands — rainbow stripes of blooming tulips bokeh, traditional windmill silhouette, springtime Holland",
  "Cappadocia hot air balloons — pink-orange sunrise sky filled with dozens of balloons bokeh, fairy chimney rocks, Turkey magic",
  "Plitvice Lakes waterfall — turquoise cascading lakes bokeh, lush emerald forest, mineral-blue mountain water, Croatia dream",
  "Banff Canadian Rockies — Lake Louise turquoise water bokeh, sharp mountain peaks reflection, evergreen forest, alpine perfection",
  "Istanbul Bosphorus rooftop — Blue Mosque and Hagia Sophia minarets silhouette bokeh, Bosphorus strait below, golden hour call-to-prayer ambience, Turkish heritage",
  "Istanbul Galata Tower view — historic stone tower bokeh, red-tiled rooftops cascading to the strait, soft afternoon light, Turkey romantic",
  "Pamukkale white travertine terraces — cascading mineral pools bokeh, turquoise thermal water, soft sunset light, Turkish natural wonder",
  "Cappadocia cave hotel terrace — fairy chimney rock formations bokeh, sunrise glow on tuff stone, hot air balloons in distance, Turkey magic",
  "Dubai Burj Khalifa skyline — world's tallest tower bokeh, sleek desert metropolis, golden hour glow on glass towers, modern luxury Middle East",
  "Petra Treasury Jordan — rose-red carved sandstone facade bokeh, narrow Siq passage, soft warm light, ancient wonder",
  // ── Malaysian iconic beautiful spots ──
  "Petronas Twin Towers KL — illuminated steel skyscrapers bokeh, KLCC park fountain foreground, Malaysian skyline pride",
  "Penang heritage shophouses — colorful pre-war facades and street art bokeh, Georgetown nostalgia, soft afternoon light",
  "Langkawi Sky Bridge — curved cable bridge over rainforest canopy bokeh, mountain mist, adventure travel vibe",
  "Cameron Highlands tea plantation — endless rolling green tea bushes bokeh, soft mist, cool Malaysian highland air",
  "Pulau Redang turquoise beach — crystal water and white sand bokeh, palm trees, Malaysian island paradise",
  "Mount Kinabalu sunrise summit — orange-pink dawn sky over Borneo peaks bokeh, achievement vibe, Malaysian highest point",
  "Melaka River waterfront — colorful murals and red-roof shophouses bokeh, twilight golden lanterns reflecting on water, heritage charm",
];

// Helper to pick a hand-POV background for PROD Goyang2 videos.
// Rotates through the list deterministically by index so a batch of 5
// videos covers 5 different settings. Wraps around for larger batches.
export function pickHandPovBackground(videoIdx: number): string {
  return HAND_POV_BACKGROUNDS[videoIdx % HAND_POV_BACKGROUNDS.length];
}

// Backward-compat alias — old name kept exported in case anything else imports it
export const LUXURY_VEHICLE_BACKGROUNDS = HAND_POV_BACKGROUNDS;
export const pickLuxuryBackground = pickHandPovBackground;

// 30-line rotation pool for shopMode=true. Master planner picks one per
// video index (modulo 30) so consecutive videos never duplicate the line.
export const SHOP_CTA_VARIATIONS: string[] = [
  "Tekan beg kuning sekarang!",
  "Cepat tekan beg kuning!",
  "Beg kuning bawah tu, tekan!",
  "Grab sekarang, beg kuning!",
  "Stok sikit je, beg kuning!",
  "Tekan beg kuning, COD boleh!",
  "Jom tekan beg kuning cepat!",
  "Beg kuning tu, jangan lepas!",
  "Hari ni je, tekan beg kuning!",
  "Last stock, beg kuning sekarang!",
  "Tekan beg kuning, confirm best!",
  "Beg kuning bawah, grab cepat!",
  "Harga gila, tekan beg kuning!",
  "Free postage, beg kuning sekarang!",
  "Offer tamat esok, beg kuning!",
  "Bayar bila sampai, beg kuning!",
  "Viral dah ni, tekan beg kuning!",
  "Terbukti berkesan, beg kuning!",
  "Jangan scroll lagi, beg kuning!",
  "Beg kuning je, senang order!",
  "Tekan sebelum sold out!",
  "Beg kuning, sampai esok!",
  "Harga promosi, beg kuning cepat!",
  "Ramai dah order, beg kuning!",
  "Cuba dulu, tekan beg kuning!",
  "Beg kuning bawah, tak rugi!",
  "Tekan beg kuning, confirm berbaloi!",
  "Order sekarang, beg kuning bawah!",
  "Klik beg kuning, barang on the way!",
  "Last chance, tekan beg kuning!",
];

// Picks a CTA for the given video index. shopMode=true → rotate the 30
// "beg kuning" variants by index. Otherwise fall back to the framework's
// default ctaStyle. Custom CTA + no-CTA modes are handled at the prompt
// level (the planner sees the user's ctaInstruction directly).
export function pickCta(opts: {
  videoIdx: number;
  shopMode: boolean;
  framework: Framework;
}): string {
  if (opts.shopMode) {
    return SHOP_CTA_VARIATIONS[opts.videoIdx % SHOP_CTA_VARIATIONS.length];
  }
  return opts.framework.ctaStyle;
}

// Type-color map shared with the UI framework chip rendering.
export const TYPE_COLORS: Record<FrameworkType, string> = {
  ugc: "#22c55e",
  product: "#3b82f6",
  lifestyle: "#f59e0b",
};

// Pretty type label for the info modal.
export function typeLabel(t: FrameworkType): string {
  if (t === "ugc") return "UGC (Character)";
  if (t === "product") return "Product (No Person)";
  return "Lifestyle (Scene)";
}
