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
  },
];

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
