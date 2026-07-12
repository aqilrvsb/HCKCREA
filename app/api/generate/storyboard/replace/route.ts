import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { loadSubCards, extractGlobalRules, extractSubCard } from "@/lib/storyboard-cards";

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
  if (!historyId || !sub) return NextResponse.json({ error: "history_id + sub diperlukan" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, metadata").eq("id", historyId).maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Storyboard tak dijumpai" }, { status: 404 });
  const meta = (row.metadata || {}) as Record<string, any>;
  if (meta.feature !== "storyboard") return NextResponse.json({ error: "Bukan baris storyboard" }, { status: 400 });

  const productName = String(meta.product_name || "");
  const productDetail = String(meta.product_detail || "");
  const productImages: string[] = (Array.isArray(meta.image_urls) ? meta.image_urls : []).filter((u: any) => typeof u === "string" && u.trim()).slice(0, 3);
  const avatarUrl = String(meta.avatar_url || "").trim();

  const unit = await priceFor(user.id, "image_generate", "gpt_image");
  if (!(await hasEnoughCredits(user.id, unit))) {
    return NextResponse.json({ error: `Kredit tak cukup (perlu RM ${unit.toFixed(2)}).` }, { status: 402 });
  }

  // Flip the row to pending immediately with the new sub so the card morphs.
  await admin
    .from("history")
    .update({
      status: "pending",
      output_url: null,
      error_message: null,
      cost: unit,
      prompt: `Storyboard · ${sub} (tukar) · ${productName || "produk"}`,
      metadata: { ...meta, main, sub, upload_status: "queued" },
    })
    .eq("id", historyId);

  after(async () => {
    const doc = await loadSubCards();
    const globalRules = extractGlobalRules(doc);
    const card = extractSubCard(doc, sub);
    const mainLabel = mainLabelOf(main);
    const avatarLine = avatarUrl
      ? `KEKAL AVATAR — a presenter face reference image is attached. EVERY frame that shows a human presenter MUST use THAT exact same face/person (identical across all frames). Frames with NO person must NOT add a person.\n`
      : ``;

    const sysPrompt = card
      ? `You are a Pening Lab storyboard specialist. Produce ONE image-generation prompt for a 9:16 storyboard GRID by following the RULES and the SUB-CATEGORY CARD below EXACTLY (its Signature must dominate ≥3–4 frames; follow its 10s beat flow and frame-by-frame guidance).\n\n${globalRules}\n\n=== SUB-CATEGORY CARD (${sub}, ${mainLabel}) ===\n${card}\n\n=== TASK ===\nWrite the storyboard image prompt now: begin with "ONE single 9:16 storyboard grid for ONE video only.", grid spec, this card's Signature + shots as per-frame directions following its beat flow, Malaysian talent + local setting, product identity lock (verbatim label), one short claim-safe BM caption per frame, neutral problem framing. Output ONLY the final image prompt.`
      : `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). The prompt MUST BEGIN with "ONE single 9:16 storyboard grid for ONE video only." Execute the "${sub}" sub-style under ${mainLabel}, Malaysian talent, short BM captions, product identity locked, neutral framing. Output ONLY the final image prompt.`;

    const userPrompt =
      `Product: ${productName || "(unnamed)"}\nDetail: ${productDetail || "(none)"}\nSub-style: ${sub} · Category: ${mainLabel}\n${avatarLine}Write the storyboard image prompt now.`;

    let prompt = `ONE single 9:16 storyboard grid for ONE video only. A ${sub} storyboard for ${productName || "the product"}, 6-9 panels, Malaysian UGC talent, product shown clearly with exact label.`;
    try {
      const llm = await orChat({ modelKey: "model_custom_idea", systemPrompt: sysPrompt, userPrompt, temperature: 0.9, maxTokens: 800 });
      if (llm.ok && llm.content && llm.content.trim().length > 40) prompt = llm.content.trim();
    } catch {
      /* fall back */
    }
    if (avatarUrl) prompt = `${prompt}\n\nPRESENTER LOCK: the attached face reference is the fixed avatar — every human shown must be that exact same person/face across all frames; frames with no person stay person-free.`;

    const refImages = (avatarUrl ? [avatarUrl, ...productImages] : productImages).slice(0, 4);
    const r = await generateImageWithCascade({ primaryModel: STORYBOARD_MODEL, prompt, aspectRatio: "9:16", imageUrls: refImages.length > 0 ? refImages : undefined });
    if (r.ok) {
      const { data: cur } = await admin.from("history").select("metadata").eq("id", historyId).single();
      await admin.from("history").update({ task_id: r.taskId, prompt, metadata: { ...(cur?.metadata || {}), provider: r.actualProvider, slot: r.actualSlot, model: r.actualModel } }).eq("id", historyId);
    } else {
      await admin.from("history").update({ status: "failed", error_message: r.error }).eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId });
}
