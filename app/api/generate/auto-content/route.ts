import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { orChat, orChatVision } from "@/lib/openrouter";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// POST /api/generate/auto-content
// 1. Generate master plan via OpenRouter (NOT deducted, per product decision)
// 2. Insert batch + N pending history rows linked to it
// 3. Spawn N P2 video tasks in parallel; client polls each via /generate/status
// 4. Each successful video deducts video_8s rate from credits
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const productUrl = String(body?.product_url || "").trim();
  const productImageUrl = String(body?.product_image_url || "").trim();
  const productName = String(body?.product_name || "").trim();
  const quantity = Math.min(10, Math.max(1, Number(body?.quantity || 5)));
  const durationMode: "8" | "16" = body?.duration === "16" ? "16" : "8";
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const avatarGender = String(body?.avatar_gender || "auto");
  const avatarHijab = String(body?.avatar_hijab || "auto");
  const avatarAge = String(body?.avatar_age || "auto");
  const ctaMode = String(body?.cta_mode || "shop");
  const customCta = String(body?.custom_cta || "");
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!productImageUrl && !productUrl) {
    return NextResponse.json(
      { error: "Sila masuk product URL atau upload gambar produk" },
      { status: 400 }
    );
  }

  // Pre-flight credit check — total = N × video rate (master plan is free)
  const videoRate = await priceFor(
    user.id,
    durationMode === "16" ? "video_16s" : "video_8s"
  );
  const totalCost = videoRate * quantity;
  if (!(await hasEnoughCredits(user.id, totalCost))) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
      { status: 402 }
    );
  }

  // Resolve CTA copy from mode
  let ctaInstruction: string;
  if (ctaMode === "none") {
    ctaInstruction = "no explicit call-to-action — let the dialog feel organic";
  } else if (ctaMode === "custom" && customCta.trim()) {
    ctaInstruction = `should include: "${customCta.trim()}"`;
  } else {
    ctaInstruction = `should mention "tekan beg kuning bawah"`;
  }

  // Build avatar persona constraint from the dropdowns
  const personaParts: string[] = [];
  if (avatarGender !== "auto") {
    personaParts.push(avatarGender === "male" ? "Malay man" : "Malay woman");
  } else {
    personaParts.push("Malay creator");
  }
  if (avatarHijab !== "auto") {
    personaParts.push(avatarHijab === "hijab" ? "wearing a hijab" : "not wearing a hijab");
  }
  if (avatarAge !== "auto") {
    personaParts.push(`in their ${avatarAge.replace("s", "")}s`);
  }
  const personaConstraint = personaParts.join(", ");

  // 1a. Product OCR — when an image is provided, run a quick vision pass to
  //     extract the product's main text/logo/color so the master planner can
  //     bake those facts into the prompts (and Veo r2v keeps the label readable).
  //     Mirrors creative-hack-auto's analyzeProductText helper.
  let productMeta: {
    main_text?: string;
    subtitle?: string;
    logo_description?: string;
    package_color?: string;
  } | null = null;
  if (productImageUrl) {
    const ocr = await orChatVision({
      modelKey: "model_product_ocr",
      systemPrompt:
        "You are a product label reader. Output ONLY valid JSON describing what the camera sees on the package. Keys: main_text (most prominent text/brand), subtitle, logo_description, package_color. If a key is unknown, use empty string. No prose, no markdown.",
      textPrompt:
        "Read the product packaging in this image. Return JSON only: {\"main_text\":\"\",\"subtitle\":\"\",\"logo_description\":\"\",\"package_color\":\"\"}.",
      images: [productImageUrl],
      temperature: 0.1,
      maxTokens: 400,
    });
    if (ocr.ok && ocr.content) {
      try {
        const s = ocr.content.indexOf("{");
        const e = ocr.content.lastIndexOf("}");
        if (s >= 0 && e > s) productMeta = JSON.parse(ocr.content.substring(s, e + 1));
      } catch {
        // OCR is best-effort — drop silently if parse fails
      }
    }
  }

  const productLockBlock = productMeta?.main_text
    ? `\n\nPRODUCT LOCK (mandatory in every prompt):\n- Package main text: "${productMeta.main_text}"${productMeta.subtitle ? `\n- Subtitle: "${productMeta.subtitle}"` : ""}${productMeta.logo_description ? `\n- Logo: ${productMeta.logo_description}` : ""}${productMeta.package_color ? `\n- Package color: ${productMeta.package_color}` : ""}\n- Product MUST stay pixel-identical to reference: same exact text, logo, colors, layout. Sharp focus on label.`
    : "";

  // 1b. Master plan via OpenRouter (vision if product image present, text otherwise)
  const systemPrompt = `You are a Malaysian TikTok Shop creative director. Output a JSON array of ${quantity} short UGC video plans. Each plan: { "framework": string, "prompt": string, "caption": string }. Prompts must be in Bahasa Melayu, 200-400 words, describing ONE ${personaConstraint} speaking to camera with the product, holding/using/showing it naturally. All ${quantity} plans must use the SAME persona type (${personaConstraint}) for consistency, but vary the scene, framework, hook, and emotion. The CTA ${ctaInstruction}. Aspect ratio: ${aspectRatio}.

Each prompt MUST include:
- A 0-2s viral hook (informal Malay — "eh korang", "serious ni", "tau tak")
- Specific scene + framing (kitchen / car / vanity / cafe / bedroom / gym / etc.)
- Mouth visibly open/close in sync with dialog (lip-sync lock)
- Both hands visible in frame
- Clean RAW UNEDITED FOOTAGE aesthetic — bottom 25% of frame empty, no subtitles, no captions, no overlays, no icons
- Audio: ONE single voice only, no music, no SFX, no background chatter
- Product stays sharp and unchanged — no warped label, no recolor, no text drift${productLockBlock}

ONLY return the JSON array, no prose, no markdown.`;

  const userPrompt = `Product: ${productName || productUrl || "Malaysian product"}
Quantity: ${quantity}
Duration per video: ${durationMode}s
${productUrl ? `URL: ${productUrl}` : ""}
${productMeta?.main_text ? `Product label reads: "${productMeta.main_text}"` : ""}`;

  const plan = productImageUrl
    ? await orChatVision({
        modelKey: "model_auto",
        systemPrompt,
        textPrompt: userPrompt,
        images: [productImageUrl],
        temperature: 0.85,
        maxTokens: Math.min(40000, quantity * 1800),
      })
    : await orChat({
        modelKey: "model_auto",
        systemPrompt,
        userPrompt,
        temperature: 0.85,
        maxTokens: Math.min(40000, quantity * 1800),
      });
  if (!plan.ok || !plan.content) {
    return NextResponse.json(
      { error: plan.error || "Master plan failed" },
      { status: 502 }
    );
  }

  // Parse JSON array (with truncation recovery)
  let parsed: any[] = [];
  try {
    let cleaned = plan.content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    } else if (plan.finishReason === "length") {
      // Truncated — close at last valid }
      const lastClose = cleaned.lastIndexOf("},");
      if (lastClose > 0) cleaned = cleaned.substring(0, lastClose + 1) + "]";
    }
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Master plan parse failed: ${e?.message}` },
      { status: 502 }
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return NextResponse.json({ error: "Empty master plan" }, { status: 502 });
  }

  // 2. Insert batch
  const admin = createAdminClient();
  const { data: batch } = await admin
    .from("batches")
    .insert({
      user_id: user.id,
      project_id: projectId,
      product_url: productUrl,
      product_name: productName,
      product_image_url: productImageUrl,
      quantity: parsed.length,
      duration_mode: durationMode,
      cta_mode: ctaMode,
      custom_cta: ctaMode === "custom" ? customCta || null : null,
      avatar_gender: avatarGender,
      avatar_hijab: avatarHijab,
      avatar_age: avatarAge,
      status: "generating",
      master_plan: parsed,
    })
    .select()
    .single();

  // 3. Spawn P2 video tasks in parallel
  const cfg = await getP2Config();
  const model = productImageUrl ? cfg.videoR2V : cfg.videoT2V;

  const histories: any[] = [];
  await Promise.all(
    parsed.map(async (item: any, idx: number) => {
      const created = await p2CreateTask({
        model,
        prompt: String(item.prompt || ""),
        imageUrls: productImageUrl ? [productImageUrl] : [],
        durationMode,
        aspectRatio,
        imageMode: productImageUrl ? "ingredient" : "text",
      });

      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: String(item.prompt || ""),
          caption: String(item.caption || ""),
          framework: String(item.framework || `Video ${idx + 1}`),
          reference_url: productImageUrl || null,
          task_id: created.task_id || null,
          duration: durationMode === "16" ? 16 : 8,
          cost: videoRate,
          batch_id: batch?.id,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: { idx, model, batch_id: batch?.id },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );

  return NextResponse.json({
    ok: true,
    batch_id: batch?.id,
    history_ids: histories.map((h) => h.id),
    quantity: parsed.length,
    total_cost: totalCost,
  });
}
