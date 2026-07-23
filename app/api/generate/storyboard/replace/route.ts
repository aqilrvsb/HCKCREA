import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { loadSubCards, extractGlobalRules, extractSubCard } from "@/lib/storyboard-cards";
import { productLockRule } from "@/lib/storyboard-locks";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/generate/storyboard/replace
// Body: { history_id, main, sub }
//
// "Tukar sub" — regenerate ONE storyboard IN PLACE with a different sub-style,
// keeping its history row (and its batch position). Reuses the product +
// avatar stored on the row's metadata; rebuilds the prompt from the new sub's
// card. Used from the History card when a storyboard is broken/unwanted.

const STORYBOARD_MODEL = "gpt-image-2";
const mainLabelOf = (m: "ugc" | "pc") => (m === "pc" ? "Product Commercial (polished, cinematic)" : "UGC (realistic, TikTok/Reels)");

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const main: "ugc" | "pc" = body?.main === "pc" ? "pc" : "ugc";
  const sub = String(body?.sub || "").trim();
  const bodyPage = Number(body?.page);
  if (!historyId || !sub) return NextResponse.json({ error: "history_id + sub diperlukan" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, project_id, metadata").eq("id", historyId).maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Storyboard tak dijumpai" }, { status: 404 });
  const meta = (row.metadata || {}) as Record<string, any>;
  if (meta.feature !== "storyboard") return NextResponse.json({ error: "Bukan baris storyboard" }, { status: 400 });

  const productName = String(meta.product_name || "");
  const productDetail = String(meta.product_detail || "");
  const productImages: string[] = (Array.isArray(meta.image_urls) ? meta.image_urls : []).filter((u: any) => typeof u === "string" && u.trim()).slice(0, 3);
  const avatarUrls: string[] = (Array.isArray(meta.avatar_urls) ? meta.avatar_urls : meta.avatar_url ? [meta.avatar_url] : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 2);
  const avatarUrl = avatarUrls[0] || "";

  const unit = await priceFor(user.id, "image_generate", "gpt_image");
  if (!(await hasEnoughCredits(user.id, unit))) {
    return NextResponse.json({ error: `Kredit tak cukup (perlu RM ${unit.toFixed(2)}).` }, { status: 402 });
  }

  // Create a NEW row (fresh id → fresh B2 key, avoiding the old image's
  // immutable-cache) at the SAME batch position, then remove the old row.
  const { data: newRow } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: (row as any).project_id ?? null,
      type: "image",
      tab: "image",
      status: "pending",
      prompt: `Storyboard · ${sub} (tukar) · ${productName || "produk"}`,
      reference_url: productImages[0] || null,
      cost: unit,
      metadata: { ...meta, main, sub, upload_status: "queued" },
    })
    .select("id")
    .single();
  const targetId = newRow?.id;
  if (!targetId) return NextResponse.json({ error: "DB insert gagal" }, { status: 500 });
  await admin.from("history").delete().eq("id", historyId).eq("user_id", user.id);

  after(async () => {
    // Rebuild from the SAME sub-style page (1/2/3), so replacing a page-2/3
    // storyboard keeps its variety set. Prefer the page the modal sent (which
    // reflects the sub the user just picked), else the row's stored page.
    const pick = bodyPage === 2 ? 2 : bodyPage === 3 ? 3 : bodyPage === 1 ? 1 : (meta.sub_page === 2 ? 2 : meta.sub_page === 3 ? 3 : 1);
    const doc = await loadSubCards(pick as 1 | 2 | 3);
    const globalRules = extractGlobalRules(doc);
    const card = extractSubCard(doc, sub);
    const mainLabel = mainLabelOf(main);
    const avatarLine = avatarUrl
      ? `KEKAL AVATAR — a presenter face reference image is attached. EVERY frame that shows a human presenter MUST use THAT exact same face/person (identical across all frames). Frames with NO person must NOT add a person.\n`
      : ``;
    // Caption instruction flipped by the original storyboard's No-subtitle flag.
    const captionClause = meta.no_subtitle === true
      ? "NO captions/subtitles/on-screen text anywhere (pure visuals only)"
      : "one short claim-safe BM caption per frame";

    const sysPrompt = card
      ? `You are a Pening Lab storyboard specialist. Produce ONE image-generation prompt for a 9:16 storyboard GRID by following the RULES and the SUB-CATEGORY CARD below EXACTLY (its Signature must dominate ≥3–4 frames; follow its 10s beat flow and frame-by-frame guidance).\n\n${globalRules}\n\n=== SUB-CATEGORY CARD (${sub}, ${mainLabel}) ===\n${card}\n\n=== TASK ===\nWrite the storyboard image prompt now: begin with "ONE single 9:16 storyboard grid for ONE video only.", grid spec, this card's Signature + shots as per-frame directions following its beat flow, Malaysian talent + local setting, product identity lock (verbatim label), ${captionClause}, neutral problem framing. Output ONLY the final image prompt.`
      : `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). The prompt MUST BEGIN with "ONE single 9:16 storyboard grid for ONE video only." Execute the "${sub}" sub-style under ${mainLabel}, Malaysian talent, ${captionClause}, product identity locked, neutral framing. Output ONLY the final image prompt.`;

    // Preserve the campaign role so a resubmitted/tukar'd segment CONTINUES
    // the arc with the segments that already succeeded (segment N of M =
    // opening / middle / closing+CTA), not a standalone.
    const cIdx = Number(meta.campaign_index || 0);
    const cTotal = Number(meta.campaign_total || 0);
    const isCampaign = !!meta.campaign && cTotal >= 2 && cIdx >= 1;
    let roleLine = "";
    if (isCampaign) {
      roleLine =
        cIdx === 1
          ? `This is the OPENING storyboard (segment 1 of ${cTotal}) of ONE continuous campaign — problem/hook phase, product not yet used; NO call-to-action, end on a hook into the next segment.\n`
          : cIdx === cTotal
            ? `This is the CLOSING storyboard (final segment ${cIdx} of ${cTotal}) of ONE continuous campaign — result/payoff phase, end with the ONE call-to-action (CTA). This is the ONLY segment with a CTA.\n`
            : `This is the MIDDLE storyboard (segment ${cIdx} of ${cTotal}) of ONE continuous campaign — a DIFFERENT phase (demo/proof); NO call-to-action; bridge into the next segment.\n`;
      roleLine += `CAMPAIGN RULES: it must CONTINUE the story of the other segments (same product identity, distinct actions — never duplicate another segment's hero action). Only the final segment has a CTA.\n`;
    }

    const userPrompt =
      `Product: ${productName || "(unnamed)"}\nDetail: ${productDetail || "(none)"}\nSub-style: ${sub} · Category: ${mainLabel}\n${roleLine}${avatarLine}Write the storyboard image prompt now.`;

    // Built BEFORE the locks so productLockRule's index map ("images 3–5 are
    // the product") describes what is ACTUALLY sent — the cap-5 slice can drop
    // trailing product photos, and a lock pointing at an image that wasn't
    // attached is worse than no lock at all.
    const refImages = [...avatarUrls, ...productImages].slice(0, 5);
    const sentAvatars = Math.min(avatarUrls.length, refImages.length);
    const sentProducts = refImages.length - sentAvatars;

    let prompt = `ONE single 9:16 storyboard grid for ONE video only. A ${sub} storyboard for ${productName || "the product"}, 6-9 panels, Malaysian UGC talent, product shown clearly with exact label.`;
    try {
      const llm = await orChat({ modelKey: "model_custom_idea", systemPrompt: sysPrompt, userPrompt, temperature: 0.9, maxTokens: 800 });
      if (llm.ok && llm.content && llm.content.trim().length > 40) prompt = llm.content.trim();
    } catch {
      /* fall back */
    }
    if (avatarUrl) prompt = `${prompt}\n\nPRESENTER LOCK: the attached face reference is the fixed avatar — every human shown must be that exact same person/face across all frames; frames with no person stay person-free.`;
    // Hard product lock — colour / cap / shape / label text copied verbatim.
    // Counts are taken from refImages (post cap-5 slice) so the index map
    // matches what is actually attached. Same rule as the original fire.
    prompt = `${prompt}${productLockRule(sentAvatars, sentProducts)}`;
    // No-CTA carried from the original storyboard (single/quantity only).
    if (meta.no_cta === true && !isCampaign) {
      prompt = `${prompt}\n\nNO CALL-TO-ACTION: do NOT include any call-to-action anywhere — no 'buy now', 'order', 'add to cart', 'swipe up', 'link in bio', price tags or purchase prompts, and no final CTA frame. End on the content/benefit itself, not on a sell.`;
    }
    // Hard no-subtitle/no-text rule — ONLY when the original had it ticked.
    if (meta.no_subtitle === true) {
      prompt = `${prompt}\n\nABSOLUTE HARD RULE — NO TEXT WHATSOEVER: this storyboard image must contain ZERO text of any kind. No subtitles, no captions, no on-screen words, no dialogue text, no headlines, no labels overlaid on the scene, no watermarks, no typography, no lettering, no numbers, no speech bubbles, no UI/graphics text. The ONLY text allowed is the product's own real packaging label as it physically appears on the product. Every panel is pure imagery (people, product, action, setting) with NO written words added.`;
    }

    const r = await generateImageWithCascade({ primaryModel: STORYBOARD_MODEL, prompt, aspectRatio: "9:16", imageUrls: refImages.length > 0 ? refImages : undefined });
    if (r.ok) {
      const { data: cur } = await admin.from("history").select("metadata").eq("id", targetId).single();
      await admin.from("history").update({ task_id: r.taskId, prompt, metadata: { ...(cur?.metadata || {}), provider: r.actualProvider, slot: r.actualSlot, model: r.actualModel, sub_page: pick } }).eq("id", targetId);
    } else {
      await admin.from("history").update({ status: "failed", error_message: r.error }).eq("id", targetId);
    }
  });

  return NextResponse.json({ ok: true, history_id: targetId });
}
