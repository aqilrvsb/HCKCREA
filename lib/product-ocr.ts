// Product OCR — extract text/logo/layout from a product image so we can
// preserve label fidelity across video segment cuts.
//
// Why this exists: when a 16s clip is generated as seg-1 + seg-2 with seg-2
// using an extracted frame from seg-1 as its r2v reference, Veo regenerates
// from PIXELS not from the original product image. The label tends to garble
// (DENDENG → DEMNNG, NYET → NYUE, etc.). Injecting a TEXT LOCK block built
// from this OCR pass forces Veo to render the package text character-perfect.
//
// Port of creative-hack-auto/background.js analyzeProductText + productTextLockBlock.

import { createAdminClient } from "@/lib/supabase/admin";
import { orChatVision } from "@/lib/openrouter";

export type ProductOcr = {
  main_text: string | null;
  subtitle: string | null;
  logo_description: string | null;
  package_color: string | null;
  text_font_style: string | null;
  text_layout: string | null;
};

const OCR_SYSTEM_PROMPT = `You are a precise OCR + visual analyst. Read the text on a product package exactly as printed.
Return ONLY this JSON shape (no other fields, no markdown):
{
  "main_text": "largest/most prominent text on the package, exact spelling + capitalization",
  "subtitle": "smaller secondary text if any, else null",
  "logo_description": "icon/logo position + appearance (e.g. 'red flame icon centered above main text')",
  "package_color": "dominant background color (e.g. 'bright yellow')",
  "text_font_style": "brief font description (e.g. 'bold white serif with outline')",
  "text_layout": "how text is arranged (e.g. 'centered, 3 lines stacked: DENDENG / NYET / BERAPI')"
}
Rules: copy text character-for-character, preserve case, preserve line breaks via " / " in text_layout. If a field is not visible, use null.`;

// ──────────────────────────────────────────────────────────────────────────
// analyzeProductText — call cheap vision model, return parsed OCR JSON
// ──────────────────────────────────────────────────────────────────────────

export async function analyzeProductText(
  imageUrl: string
): Promise<{ ok: boolean; data?: ProductOcr; error?: string }> {
  if (!imageUrl) return { ok: false, error: "Missing image URL" };

  // model_product_ocr cascade (code28 → DragonAPI → GRSAI → …, set in /admin/settings) — no longer OpenRouter-only.
  const r = await orChatVision({
    modelKey: "model_product_ocr",
    systemPrompt: OCR_SYSTEM_PROMPT,
    textPrompt: "Analyze this product package image. Return STRICT JSON only (no markdown, no commentary).",
    images: [imageUrl],
    temperature: 0,
    maxTokens: 400,
    timeoutMs: 60_000,
  });
  if (!r.ok) return { ok: false, error: `OCR: ${r.error || "no model answered"}` };
  const raw = r.content || "";
  // Strip markdown fences / any words around the object (Claude tends to wrap JSON in ```json)
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
  const obj = cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned;
  try {
    return { ok: true, data: JSON.parse(obj) as ProductOcr };
  } catch {
    return { ok: false, error: `OCR JSON parse failed: ${raw.substring(0, 120)}` };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// productTextLockBlock — build the LOCK block that gets appended to seg-2
// prompts. Returns "" if metadata is empty so we don't pollute prompts when
// OCR couldn't read the package.
// ──────────────────────────────────────────────────────────────────────────

export function productTextLockBlock(meta: ProductOcr | null | undefined): string {
  if (!meta || !meta.main_text) return "";
  const parts: string[] = [];
  parts.push(
    "── PRODUCT TEXT LOCK (character-perfect preservation — critical for seg 2+) ──"
  );
  parts.push(
    `Package main text: "${meta.main_text}" — exact spelling, exact capitalization.`
  );
  if (meta.subtitle) parts.push(`Secondary text: "${meta.subtitle}".`);
  if (meta.text_layout) parts.push(`Layout: ${meta.text_layout}.`);
  if (meta.text_font_style) parts.push(`Font: ${meta.text_font_style}.`);
  if (meta.logo_description) parts.push(`Logo: ${meta.logo_description}.`);
  if (meta.package_color) parts.push(`Package color: ${meta.package_color}.`);
  parts.push(
    "Do NOT alter letters. Do NOT change the logo. Do NOT shift the layout. If product text appears in frame, it MUST match the description above character-for-character."
  );
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Cached OCR — checks product_ocr_cache table first, runs analysis if miss,
// stores result for next time. Keyed by (user_id, product_image_url).
// ──────────────────────────────────────────────────────────────────────────

export async function getCachedProductOcr(
  userId: string,
  productImageUrl: string
): Promise<ProductOcr | null> {
  if (!productImageUrl) return null;
  const admin = createAdminClient();

  // Check cache
  const { data: cached } = await admin
    .from("product_ocr_cache")
    .select("ocr_data")
    .eq("user_id", userId)
    .eq("product_image_url", productImageUrl)
    .maybeSingle();
  if (cached?.ocr_data) return cached.ocr_data as ProductOcr;

  // Cache miss — run OCR
  const result = await analyzeProductText(productImageUrl);
  if (!result.ok || !result.data) return null;

  // Persist (best-effort; failure not fatal)
  try {
    await admin
      .from("product_ocr_cache")
      .insert({
        user_id: userId,
        product_image_url: productImageUrl,
        ocr_data: result.data,
      });
  } catch {
    // ignore — cache miss next time is fine
  }

  return result.data;
}
