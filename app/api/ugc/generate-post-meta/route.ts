import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/ugc/generate-post-meta
// Body: { history_id, product_url? }
//
// UGC tab + Agent UGC rows generate a Veo prompt + the rendered video,
// but they don't get the auto-content master-plan extras (caption +
// 5 hashtags + cover_title + cover_subtitle). The extension's auto-post
// step needs all four so the post lands cleanly.
//
// This endpoint is the slim sister of auto-content's master plan — same
// caption/cover rules, applied to a SINGLE video's existing prompt
// (not a fresh batch plan). Caller passes:
//   - history_id  → we read the row's prompt + reference + product fields
//   - product_url? → optional TikTok Shop URL the user pasts in the
//                    extension. We extract the product_id and stamp it
//                    on the row for auto-post deep-linking.
//
// Returns { caption, hashtags[], cover_title, cover_subtitle,
//           tiktok_product_id, product_name }, also persists them on
// the row's metadata + caption column so re-asking is cheap.
export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const productUrl = String(body?.product_url || "").trim();
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, prompt, caption, reference_url, metadata"
    )
    .eq("id", historyId)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta = (row.metadata || {}) as Record<string, any>;

  // Extract TikTok product_id + name from the URL the user pasted (if any).
  // Long numeric run after /pdp/<slug>/ or /product/.
  let tiktokProductId = String(meta.tiktok_product_id || "");
  if (productUrl && /tiktok\.com\//.test(productUrl)) {
    const m =
      productUrl.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i) ||
      productUrl.match(/\/(\d{15,20})(?:[/?#]|$)/);
    if (m) tiktokProductId = m[1];
  }

  const productName = String(meta.product_name || "").trim();

  // Build a tight system prompt — matches auto-content's caption + cover
  // rules so output looks like it came from the same editorial brain.
  const systemPrompt = `You write TikTok post metadata for Malaysian UGC creators. Output ONLY a JSON object — no markdown, no commentary.

Required keys:
- caption: 2-3 sentences in informal Bahasa Melayu (korang, aku, ni, tu, memang, gila), 50-280 chars, ending with EXACTLY 5 viral hashtags. The 5 hashtags MUST be different categories: product category, benefit, problem/solution, Malaysian trending, buying intent. NO duplicate tags.
- cover_title: EXACTLY 2 words, ALL CAPS, ends with "?" or "!". Pain question / interrupt / bold claim — NEVER the product name. Examples: "GATAL BAU?", "ASYIK SEMPIT?", "STOP!", "MAHAL KAN?"
- cover_subtitle: 3-6 words, ALL CAPS, completes the hook from cover_title. Patterns: urgency / result-timeline / instruction / empathy. Examples: "JANGAN BIAR LAMA!", "30 HARI BOLEH GLOW", "TENGOK NI DULU".

Tone: real Malaysian friend sharing, never an ad. The cover text + caption together should make a viewer who's scrolling stop and feel "eh, ni pasal masalah aku".`;

  const userPrompt = `Video prompt body (for context only — describes the scene/subject):
"""
${(row.prompt || "").substring(0, 2000)}
"""

${productName ? `Product: ${productName}` : "Product: (unknown — derive a generic Malay-friendly UGC angle from the prompt body)"}
${productUrl ? `Product URL: ${productUrl}` : ""}

Existing caption (rewrite if weak/empty): ${row.caption || "(none)"}

Return JSON only. No markdown, no prose. Start with { and end with }.`;

  const llm = await orChat({
    modelKey: "model_auto",
    systemPrompt,
    userPrompt,
    temperature: 0.85,
    maxTokens: 1200,
  });
  if (!llm.ok || !llm.content) {
    return NextResponse.json(
      { error: llm.error || "LLM call failed" },
      { status: 502 }
    );
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
    return NextResponse.json(
      { error: `Parse failed: ${e?.message}`, raw: llm.content.substring(0, 300) },
      { status: 502 }
    );
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

  // Re-extract the final 5 hashtags as an array for the extension.
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

  // Persist on the row so subsequent extension loads can read directly
  // without re-spending an LLM call. Caption replaces what was there;
  // cover text + product_id go into metadata alongside the existing fields.
  await admin
    .from("history")
    .update({
      caption,
      metadata: {
        ...meta,
        cover_title: coverTitle,
        cover_subtitle: coverSubtitle,
        tiktok_product_id: tiktokProductId || meta.tiktok_product_id || null,
      },
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    caption,
    hashtags: finalHashtags,
    cover_title: coverTitle,
    cover_subtitle: coverSubtitle,
    tiktok_product_id: tiktokProductId || null,
    product_name: productName || null,
  });
}
