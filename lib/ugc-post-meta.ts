// Generate caption + 5 hashtags + cover_title + cover_subtitle for a
// UGC history row, persist them on the row, and return the result.
//
// Used by:
//   - POST /api/ugc/generate-post-meta  (extension on-demand)
//   - lib/settle.ts                     (fire-and-forget when UGC settles)
//
// Hits the same admin-rotated LLM as auto-content's master plan
// (orChat with modelKey "model_auto") so the editorial voice stays
// consistent across both flows.

import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { HOOK_BANK, pickHooks, inferHookCategory } from "@/lib/hook-bank";

export type UgcPostMetaResult = {
  ok: boolean;
  caption?: string;
  hashtags?: string[];
  cover_title?: string;
  cover_subtitle?: string;
  tiktok_product_id?: string | null;
  product_name?: string | null;
  error?: string;
  // Indicates we skipped the LLM because the row already has good meta.
  skipped?: boolean;
  raw?: string;
};

// Distinct copy angles rotated per-video (by seed) so bulk-assigned
// videos for the SAME product each lead with a different emotional hook
// instead of all sounding identical.
const COVER_ANGLES = [
  "pain/masalah (before)",
  "hasil/transformation (after)",
  "urgency/takut terlepas",
  "harga/berbaloi",
  "social proof/ramai dah beli",
  "curiosity/rahsia",
  "empati/aku pun sama",
  "cabaran/berani try",
  "penyesalan/kenapa tak beli awal",
  "perbandingan/dulu vs sekarang",
  "soalan direct pada viewer",
  "cerita pengalaman sendiri (mini story)",
  "amaran/jangan buat silap ni",
  "kejutan/tak sangka",
  "tip/cara betul guna",
  "FOMO/stok tinggal sikit",
  "manfaat utama (benefit terus)",
  "statistik/nombor (contoh: 80% berjaya)",
  "testimoni/orang lain cakap",
  "jaminan/berani cuba",
  "myth-buster/mitos ke betul",
  "quick win/cepat nampak kesan",
  "target audience/awak pun sama ke",
  "kos kalau tak buat apa-apa",
  "lega/relief akhirnya selesai",
  "keraguan/betul ke ni",
  "stop scroll/berhenti dulu",
  "transformasi diri/aku dah berubah",
  "eksklusif/bukan semua tau",
  "simple/senang je sebenarnya",
];

// Parse the caption JSON an LLM returns, tolerating the mistakes models
// routinely make: markdown fences, a trailing comma before } or ], and
// single-quoted strings. Returns the object, or null if even the regex
// fallback finds nothing. Never throws.
function tolerantParseMeta(
  raw: string
): { caption?: string; cover_title?: string; cover_subtitle?: string } | null {
  let cleaned = String(raw || "").trim();
  // Strip a leading/trailing markdown fence.
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  // Slice to the outermost braces.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.substring(start, end + 1);

  // Attempt 1 — parse as-is.
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to repair */
  }

  // Attempt 2 — repair the two most common defects: trailing commas and
  // (naively) single-quoted property names/values.
  try {
    const repaired = cleaned
      .replace(/,\s*([}\]])/g, "$1") // drop trailing commas
      .replace(/([{,]\s*)'([^']+?)'(\s*:)/g, '$1"$2"$3') // 'key': -> "key":
      .replace(/(:\s*)'([^']*?)'(\s*[},])/g, '$1"$2"$3'); // : 'val' -> : "val"
    return JSON.parse(repaired);
  } catch {
    /* fall through to regex extraction */
  }

  // Attempt 3 — pull the 3 known fields out with regex. Handles badly
  // broken output where the JSON structure itself is unrecoverable.
  const grab = (key: string): string | undefined => {
    const m = cleaned.match(
      new RegExp(`["']?${key}["']?\\s*:\\s*["']([\\s\\S]*?)["']\\s*[,}]`, "i")
    );
    return m ? m[1].replace(/\\"/g, '"').trim() : undefined;
  };
  const caption = grab("caption");
  const cover_title = grab("cover_title");
  const cover_subtitle = grab("cover_subtitle");
  if (caption || cover_title || cover_subtitle) {
    return { caption, cover_title, cover_subtitle };
  }
  return null;
}

export async function generateUgcPostMeta(
  historyId: string,
  opts: {
    productUrl?: string;
    productName?: string;
    productDetail?: string;
    // Per-video seed (extension passes a hash of the history id). Drives
    // hook selection, the LLM variation directive, and the fallback cover
    // banks so bulk-assigned videos for the same product never duplicate.
    variantSeed?: number;
    userIdGuard?: string;
    force?: boolean;
    // "Jana assign" preserve-edits mode: keep any field the user already
    // filled (caption / cover_title / cover_subtitle) and only write the
    // ones that are still empty. Default off (full regenerate).
    fillOnlyEmpty?: boolean;
    /** Editor tab → "model_editor_text", so tuning the Editor's copywriting
     *  model never disturbs the extension / Auto UGC / Auto Content, which
     *  all share model_custom_idea. Unset = previous behaviour. */
    modelKey?: "model_custom_idea" | "model_editor_text";
    /** When true, write the caption ONLY from the product info (name + Detail
     *  Product), IGNORING the video's own prompt/scene. Editor "Jana Semula →
     *  Detail Product sahaja" uses this so on-screen context (e.g. a skincare
     *  scene) can't leak into a caption for a product the user has since
     *  re-described. Default false = previous behaviour (scene is context). */
    detailOnly?: boolean;
  } = {}
): Promise<UgcPostMetaResult> {
  if (!historyId) return { ok: false, error: "history_id required" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, prompt, caption, reference_url, metadata"
    )
    .eq("id", historyId)
    .maybeSingle();

  if (!row) return { ok: false, error: "Row not found" };
  if (opts.userIdGuard && row.user_id !== opts.userIdGuard) {
    return { ok: false, error: "Forbidden" };
  }

  const meta = (row.metadata || {}) as Record<string, any>;
  // A FRAMED row's own prompt is just "Framed intro + video" and it has no
  // product_detail — so regenerating a caption on it would be thin/nonsense.
  // Pull the ORIGINAL video's prompt + product_detail so the caption is written
  // from the real scene + product, exactly like regenerating on the original.
  if (meta.framed_from) {
    const { data: orig } = await admin
      .from("history")
      .select("prompt, metadata")
      .eq("id", String(meta.framed_from))
      .maybeSingle();
    if (orig) {
      const om = (orig.metadata || {}) as Record<string, any>;
      if (!String(meta.product_detail || meta.detail || "").trim()) {
        meta.product_detail = om.product_detail || om.detail || meta.product_detail;
      }
      if (!String(meta.product_name || "").trim()) meta.product_name = om.product_name || meta.product_name;
      // Swap the placeholder framed prompt for the original scene prompt.
      if (orig.prompt && /framed intro/i.test(String(row.prompt || ""))) {
        (row as any).prompt = orig.prompt;
      }
    }
  }
  const existingCaption = String(row.caption || "").trim();
  const existingHashCount = (existingCaption.match(/#\w+/g) || []).length;
  const hasCover = !!meta.cover_title && !!meta.cover_subtitle;

  // Skip if the row already has good meta (caption + 5 hashtags + cover).
  // The on-demand /api endpoint passes force=true to bypass this.
  if (
    !opts.force &&
    existingCaption.length >= 40 &&
    existingHashCount >= 5 &&
    hasCover
  ) {
    return {
      ok: true,
      skipped: true,
      caption: existingCaption,
      hashtags: existingCaption
        .split(/\s+/)
        .filter((t) => t.startsWith("#"))
        .slice(0, 5),
      cover_title: meta.cover_title,
      cover_subtitle: meta.cover_subtitle,
      tiktok_product_id: meta.tiktok_product_id || null,
      product_name: meta.product_name || null,
    };
  }

  // Extract the product_id (Beg Kuning link) from the URL the caller passed.
  let tiktokProductId = String(meta.tiktok_product_id || "");
  const productUrl = String(opts.productUrl || "").trim();
  if (productUrl) {
    const m =
      productUrl.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i) ||
      productUrl.match(/\/(\d{13,20})(?:[/?#]|$)/) ||
      productUrl.match(/(\d{13,20})/);
    if (m) tiktokProductId = m[1];
  }

  // Prefer the ASSIGNED product's name/detail (extension Non Saved ID flow)
  // over anything already on the row, so the caption is written for THIS
  // product.
  const productName = String(opts.productName || meta.product_name || "").trim();

  // Seed real, category-matched trending hooks (scraped from hook-affiliate)
  // so the caption opens like a proven viral line instead of a generic one.
  // Category inferred from product name + detail + the video prompt body.
  const productDetail = String(
    opts.productDetail || meta.product_detail || meta.detail || ""
  ).trim();
  // Seed everything off the per-video variant so each video in a bulk
  // assign gets a different opener + cover angle. 0 → derive from the
  // history id so single/legacy calls still vary.
  const seed =
    Math.abs(Number(opts.variantSeed) || 0) ||
    Array.from(historyId).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // detailOnly → infer the hook category from the PRODUCT info only, so a
  // skincare video prompt can't drag the hooks toward skin for a product the
  // user has re-described.
  const categorySource = opts.detailOnly
    ? `${productName} ${productDetail}`
    : `${productName} ${productDetail} ${(row.prompt || "").slice(0, 300)}`;
  // Hook category:
  //  - normal mode → the product's actual niche (skincare/makanan/…), so the
  //    opener speaks that niche's viral energy.
  //  - detailOnly → the NEUTRAL "trending" bank. Those hooks are about the
  //    deal itself (price / urgency / stock / social proof) and mention NO
  //    niche, so they add a fresh viral opener WITHOUT ever dragging a
  //    re-described product (e.g. a diabetic patch) toward the wrong angle.
  //    This is the "detail product + variant hook" combo — grounding stays on
  //    the product detail, the hook just rotates per video.
  const hookCategory = opts.detailOnly ? "trending" : inferHookCategory(categorySource);
  const hookPool = (HOOK_BANK as any)[hookCategory]?.length ? (HOOK_BANK as any)[hookCategory] as string[] : HOOK_BANK.trending;

  let hookBlock = "";
  let rrN = 0; // round-robin index (detail mode) — also rotates the cover angle
  if (opts.detailOnly) {
    // ── DETAIL-PRODUCT MODE ONLY: ROUND-ROBIN MAIN HOOK (per profile) ──
    // Each caption pulls the NEXT hook in the bank in order — video 1 → hook[0],
    // video 2 → hook[1], … cycling the whole bank — tracked on
    // profiles.settings.hook_rr_index via an ATOMIC counter, so bulk parallel
    // generations never hand two videos the same hook. This one hook is the
    // caption's MAIN opening (mandatory); the seeded others are reference/twist.
    // Falls back to the per-video seed if the counter is unavailable.
    let mainHook = "";
    try {
      const { data: rr } = await admin.rpc("next_hook_index", { uid: row.user_id });
      const n = Number(rr);
      if (Number.isFinite(n) && n > 0) { rrN = n; mainHook = hookPool[(n - 1) % hookPool.length]; } // n starts at 1 → hook[0]
    } catch { /* fall back to seed below */ }
    if (!mainHook) mainHook = hookPool[seed % hookPool.length] || "";

    const refHooks = pickHooks(hookCategory, 6, seed).filter((h) => h !== mainHook).slice(0, 5);
    hookBlock = mainHook
      ? `\n\nMAIN HOOK — use THIS as the caption's opening line, kept PUNCHY and close to the original (it's a proven viral scroll-stopper — light touch only, do NOT weaken it, do NOT force the product name into it). It is niche-neutral on purpose. The PRODUCT and its niche come through in the NEXT line (the value line), grounded on the Product detail — NOT in this opener:\n"${mainHook}"\n\nSo the shape is: line 1 = this hook (curiosity/deal/emotion), line 2 = the product + its real benefit from the detail. Do NOT invent any benefit/ingredient/problem that isn't in the Product detail.${
          refHooks.length
            ? `\n\nREFERENCE HOOKS — for TWIST/flavour only. You MAY borrow a word or emotion for the value line, but the OPENING must be the MAIN HOOK above, never these:\n${refHooks.map((h) => `- ${h}`).join("\n")}`
            : ""
        }`
      : "";
  } else {
    // ── NORMAL MODE (unchanged): category-matched hooks as loose EXAMPLES ──
    // 6 seeded candidates; the model opens with ONE line in that energy and
    // adapts it. No round-robin, no mandatory main hook.
    const seedHooks = pickHooks(hookCategory, 6, seed);
    hookBlock = seedHooks.length
      ? `\n\nTRENDING HOOK EXAMPLES (real viral ${hookCategory} affiliate hooks — open the caption with ONE line in THIS energy/style, then adapt it to THIS product; do NOT copy verbatim):\n${seedHooks
          .map((h) => `- ${h}`)
          .join("\n")}`
      : "";
  }

  // Per-video COVER ANGLE. In detail mode it rotates off the round-robin counter
  // (so 30 videos for the same product cycle through DIFFERENT title angles
  // instead of all defaulting to the product's #1 pain, e.g. "KERAP KENCING?");
  // otherwise it's seed-based. This drives cover_title + cover_subtitle.
  const coverAngle = COVER_ANGLES[(((rrN > 0 ? rrN - 1 : seed) % COVER_ANGLES.length) + COVER_ANGLES.length) % COVER_ANGLES.length];

  const systemPrompt = `You write TikTok post metadata for Malaysian UGC creators. Output ONLY a JSON object — no markdown, no commentary.

Required keys:
- caption: 2-3 sentences in informal Bahasa Melayu (korang, aku, ni, tu, memang, gila), 50-280 chars. OPEN with a scroll-stopping hook following the HOOK guidance below (if a MAIN HOOK is given, use THAT as the opener — kept punchy; the product comes in the next line), then 1 line of value about the product, ending with EXACTLY 5 viral hashtags. The 5 hashtags MUST be different categories: product category, benefit, problem/solution, Malaysian trending, buying intent. NO duplicate tags.
- cover_title: EXACTLY 2 words, ALL CAPS, ends with "?" or "!". It MUST express the COVER ANGLE given below (NOT always the product's main pain) — NEVER the product name. Because MANY videos share the same product, the title MUST change with the angle: a "pain" angle → a pain question ("KERAP KENCING?"), a "result/after" angle → a result claim ("GULA STABIL!"), "urgency" → "JANGAN TUNGGU!", "curiosity" → "RAHSIA DIA?", "harga" → "MURAH GILA?", "social proof" → "RAMAI DAH!". Do NOT output the same 2 words you'd use for a different angle.
- cover_subtitle: 3-6 words, ALL CAPS, completes the title in the SAME angle. Patterns: urgency / result-timeline / instruction / empathy. Examples: "JANGAN BIAR LAMA!", "30 HARI BOLEH GLOW", "TENGOK NI DULU".

Tone: real Malaysian friend sharing, never an ad. The cover text + caption together should make a viewer who's scrolling stop and feel "eh, ni pasal masalah aku".${hookBlock}`;

  // detailOnly → OMIT the video prompt entirely and write purely from the
  // product info, so the scene can never leak into the caption.
  const sceneBlock = opts.detailOnly
    ? `STRICT GROUNDING — write the caption using ONLY the Product name + Product detail below. Do NOT reference any video scene, and do NOT invent benefits, ingredients, or problems that are NOT explicitly written in the Product detail. If the detail is about (e.g.) blood-sugar/diabetic care, the caption, cover_title and cover_subtitle MUST be about THAT — never skincare/glowing/scars/whitening or any unrelated angle. Match the product's real purpose exactly.`
    : `Video prompt body (for context only — describes the scene/subject):
"""
${(row.prompt || "").substring(0, 2000)}
"""`;

  const userPrompt = `${sceneBlock}

${productName ? `Product: ${productName}` : "Product: (unknown — derive a generic Malay-friendly UGC angle from the product detail)"}
${productDetail ? `Product detail: ${productDetail}` : ""}
${productUrl ? `Product URL: ${productUrl}` : ""}

Existing caption (rewrite if weak/empty): ${opts.detailOnly ? "(none — write fresh from the product detail; do NOT reuse the old caption's theme)" : (existingCaption || "(none)")}

IMPORTANT — this is one of MANY videos for the SAME product, so all 3 fields MUST be UNIQUE to this video.
COVER ANGLE for THIS video: "${coverAngle}". The cover_title (2 words) AND cover_subtitle MUST express THIS angle — do NOT fall back to the product's default pain title if the angle is something else. Across the batch the titles have to ROTATE (pain → result → urgency → curiosity → price → social proof → …), never the same 2-word title twice. Also vary the caption's wording and emotion.

Return JSON only. No markdown, no prose. Start with { and end with }.`;

  // Hard 45s cap on the LLM call. Without it a single hung generation runs
  // until Vercel kills the whole function at 60s (FUNCTION_INVOCATION_TIMEOUT),
  // which the extension surfaces as a scary "deployment error" mid-batch. On
  // timeout we return ok:false → this video is SKIPPED (no fallback copy) and
  // the extension's retry pass re-fires it, instead of stalling the batch.
  const LLM_TIMEOUT_MS = 45_000;
  const llm = await Promise.race([
    orChat({
      // Default: the same slot as Auto UGC / Auto Content master plan
      // (model_custom_idea) so caption copywriting matches the on-platform
      // dialog voice. The Editor passes model_editor_text instead, which
      // falls through to model_custom_idea → model_auto when unset.
      modelKey: opts.modelKey || "model_custom_idea",
      systemPrompt,
      userPrompt,
      temperature: 0.85,
      maxTokens: 1200,
    }),
    new Promise<{ ok: false; content?: string; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, content: undefined, error: `LLM timeout after ${LLM_TIMEOUT_MS / 1000}s` }), LLM_TIMEOUT_MS)
    ),
  ]);
  // Parse the LLM JSON tolerantly — models frequently emit a trailing
  // comma, single quotes, or a markdown fence. We strip the fence, slice
  // to the outermost braces, remove trailing commas, and (last resort)
  // regex-extract the 3 fields. parsed stays {} if everything fails.
  let parsed: any = {};
  if (llm.ok && llm.content) {
    parsed = tolerantParseMeta(llm.content) || {};
  }

  // NO FALLBACK. If the LLM didn't produce a real caption + BOTH cover
  // lines, we SKIP this video entirely — write nothing, return ok:false.
  // A generic fallback would falsely mark the row "Auto-Post ready" with
  // weak duplicate copy; instead the row stays incomplete, the extension's
  // completeness gate keeps it out of Auto Post, and the user regenerates
  // it later to get a real, unique caption/cover.
  const rawCaption = String(parsed.caption || "").trim();
  const rawCoverTitle = String(parsed.cover_title || "").trim();
  const rawCoverSubtitle = String(parsed.cover_subtitle || "").trim();
  if (rawCaption.length < 20 || !rawCoverTitle || !rawCoverSubtitle) {
    return {
      ok: false,
      error: "LLM output incomplete (caption/cover) — skipped, regenerate later",
      raw: (llm.content || "").substring(0, 200),
    };
  }

  // Enforce exactly 5 hashtags (auto-content's same repair pass). Hashtags
  // are the one field we top up (they're generic by nature); the caption
  // body + cover text themselves are never synthesised.
  const FALLBACK_HASHTAGS = [
    "#TikTokShopMalaysia",
    "#ViralMY",
    "#MestiCuba",
    "#ReviewJujur",
    "#FYPMalaysia",
  ];
  let caption = rawCaption;

  const tokens = caption.split(/\s+/);
  const hashIdxs = tokens
    .map((t, i) => (t.startsWith("#") ? i : -1))
    .filter((i) => i >= 0);
  if (hashIdxs.length > 5) {
    const drop = new Set(hashIdxs.slice(5));
    caption = tokens.filter((_, i) => !drop.has(i)).join(" ");
  } else if (hashIdxs.length < 5) {
    const existing = new Set(hashIdxs.map((i) => tokens[i].toLowerCase()));
    const need = 5 - hashIdxs.length;
    const pad: string[] = [];
    for (const tag of FALLBACK_HASHTAGS) {
      if (!existing.has(tag.toLowerCase())) pad.push(tag);
      if (pad.length === need) break;
    }
    caption = `${caption.trim()} ${pad.join(" ")}`.trim();
  }

  const finalHashtags = caption
    .split(/\s+/)
    .filter((t) => t.startsWith("#"))
    .slice(0, 5);

  // Cover text is guaranteed present (we returned ok:false above otherwise),
  // so no synthesis here — just normalise casing/length.
  const coverTitle = rawCoverTitle
    .toUpperCase()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const coverSubtitle = rawCoverSubtitle.toUpperCase();

  // Fill-only-empty ("Jana Assign"): keep whatever the user already edited,
  // write the generated value ONLY into fields that were still empty. So if
  // the user edited the caption but left the cover blank, jana-assign keeps
  // the caption and fills just the cover text.
  const existCoverTitle = String(meta.cover_title || "").trim();
  const existCoverSub = String(meta.cover_subtitle || "").trim();
  const keepCaption = !!opts.fillOnlyEmpty && existingCaption.length >= 20;
  const finalCaption = keepCaption ? existingCaption : caption;
  const finalCoverTitle = opts.fillOnlyEmpty && existCoverTitle ? String(meta.cover_title) : coverTitle;
  const finalCoverSubtitle = opts.fillOnlyEmpty && existCoverSub ? String(meta.cover_subtitle) : coverSubtitle;
  const finalHashtagsOut = finalCaption.split(/\s+/).filter((t) => t.startsWith("#")).slice(0, 5);

  await admin
    .from("history")
    .update({
      caption: finalCaption,
      metadata: {
        ...meta,
        cover_title: finalCoverTitle,
        cover_subtitle: finalCoverSubtitle,
        tiktok_product_id: tiktokProductId || meta.tiktok_product_id || null,
        // Stamp the assigned product so Auto Post + future loads carry the
        // Beg Kuning link + product name/detail alongside the caption.
        product_name: productName || meta.product_name || null,
        product_detail: productDetail || meta.product_detail || null,
      },
    })
    .eq("id", row.id);

  return {
    ok: true,
    caption: finalCaption,
    hashtags: finalHashtagsOut.length ? finalHashtagsOut : finalHashtags,
    cover_title: finalCoverTitle,
    cover_subtitle: finalCoverSubtitle,
    tiktok_product_id: tiktokProductId || null,
    product_name: productName || null,
  };
}
