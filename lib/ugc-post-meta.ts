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
import { hooksForProduct } from "@/lib/hook-bank";

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

export async function generateUgcPostMeta(
  historyId: string,
  opts: {
    productUrl?: string;
    productName?: string;
    productDetail?: string;
    userIdGuard?: string;
    force?: boolean;
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
  const { category: hookCategory, hooks: seedHooks } = hooksForProduct(
    `${productName} ${productDetail} ${(row.prompt || "").slice(0, 300)}`,
    5
  );
  const hookBlock = seedHooks.length
    ? `\n\nTRENDING HOOK EXAMPLES (real viral ${hookCategory} affiliate hooks — open the caption with ONE line in THIS energy/style, then adapt it to THIS product; do not copy verbatim):\n${seedHooks
        .map((h) => `- ${h}`)
        .join("\n")}`
    : "";

  const systemPrompt = `You write TikTok post metadata for Malaysian UGC creators. Output ONLY a JSON object — no markdown, no commentary.

Required keys:
- caption: 2-3 sentences in informal Bahasa Melayu (korang, aku, ni, tu, memang, gila), 50-280 chars. OPEN with a scroll-stopping trending hook (see the hook examples below), then 1 line of value, ending with EXACTLY 5 viral hashtags. The 5 hashtags MUST be different categories: product category, benefit, problem/solution, Malaysian trending, buying intent. NO duplicate tags.
- cover_title: EXACTLY 2 words, ALL CAPS, ends with "?" or "!". Pain question / interrupt / bold claim — NEVER the product name. Examples: "GATAL BAU?", "ASYIK SEMPIT?", "STOP!", "MAHAL KAN?"
- cover_subtitle: 3-6 words, ALL CAPS, completes the hook from cover_title. Patterns: urgency / result-timeline / instruction / empathy. Examples: "JANGAN BIAR LAMA!", "30 HARI BOLEH GLOW", "TENGOK NI DULU".

Tone: real Malaysian friend sharing, never an ad. The cover text + caption together should make a viewer who's scrolling stop and feel "eh, ni pasal masalah aku".${hookBlock}`;

  const userPrompt = `Video prompt body (for context only — describes the scene/subject):
"""
${(row.prompt || "").substring(0, 2000)}
"""

${productName ? `Product: ${productName}` : "Product: (unknown — derive a generic Malay-friendly UGC angle from the prompt body)"}
${productUrl ? `Product URL: ${productUrl}` : ""}

Existing caption (rewrite if weak/empty): ${existingCaption || "(none)"}

Return JSON only. No markdown, no prose. Start with { and end with }.`;

  const llm = await orChat({
    // Same model slot as the Auto UGC / Auto Content master plan
    // (model_custom_idea) so caption copywriting matches the on-platform
    // dialog voice. Falls back to model_auto when admin hasn't set it.
    modelKey: "model_custom_idea",
    systemPrompt,
    userPrompt,
    temperature: 0.85,
    maxTokens: 1200,
  });
  if (!llm.ok || !llm.content) {
    return { ok: false, error: llm.error || "LLM call failed" };
  }

  // Parse JSON (handle markdown fence the model sometimes adds).
  let parsed: any;
  try {
    let cleaned = llm.content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.substring(start, end + 1);
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    return { ok: false, error: `Parse failed: ${e?.message}`, raw: llm.content.substring(0, 300) };
  }

  // Enforce exactly 5 hashtags (auto-content's same repair pass).
  const FALLBACK_HASHTAGS = [
    "#TikTokShopMalaysia",
    "#ViralMY",
    "#MestiCuba",
    "#ReviewJujur",
    "#FYPMalaysia",
  ];
  let caption = String(parsed.caption || "").trim();
  if (caption.length < 20) {
    const t = String(parsed.cover_title || "").trim();
    const s = String(parsed.cover_subtitle || "").trim();
    caption = `${t && s ? `${t} ${s}` : "Korang kena try ni!"} ${
      productName ? `Aku pakai ${productName.substring(0, 40)}, memang berbaloi!` : ""
    } ${FALLBACK_HASHTAGS.join(" ")}`.trim();
  }

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

  const coverTitle = String(parsed.cover_title || "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  const coverSubtitle = String(parsed.cover_subtitle || "").trim().toUpperCase();

  await admin
    .from("history")
    .update({
      caption,
      metadata: {
        ...meta,
        cover_title: coverTitle,
        cover_subtitle: coverSubtitle,
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
    caption,
    hashtags: finalHashtags,
    cover_title: coverTitle,
    cover_subtitle: coverSubtitle,
    tiktok_product_id: tiktokProductId || null,
    product_name: productName || null,
  };
}
