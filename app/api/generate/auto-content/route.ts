import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { orChat, orChatVision } from "@/lib/openrouter";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import {
  FRAMEWORKS,
  SHOP_CTA_VARIATIONS,
  type Framework,
} from "@/lib/auto-content-frameworks";

// POST /api/generate/auto-content — port of creative-hack-auto 12.8.3 pipeline.
//
// Plan modes:
//   "aiplan"   → master plan via vision, fire all Veo r2v immediately
//   "verify"   → master plan via vision, return plan to client (no Veo fired)
//   "manual"   → skip planning, use body.preset_plan, fire Veo immediately
//   "approved" → from /approve route — plan was already verified, fire Veo
//
// Body:
//   plan_mode, selected_frameworks[], preset_plan?,
//   product_mode (affiliate|manual), product_url?, product_urls_all?[],
//   product_image_url?, manual_products?[],
//   quantity, duration ('8'|'16'), aspect_ratio,
//   avatar_gender, avatar_hijab, avatar_age,
//   cta_mode (shop|custom|none), custom_cta?, project_id?
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const planMode: "aiplan" | "verify" | "manual" | "approved" =
    body?.plan_mode === "verify"
      ? "verify"
      : body?.plan_mode === "manual"
        ? "manual"
        : body?.plan_mode === "approved"
          ? "approved"
          : "aiplan";

  const selectedFrameworks: number[] = Array.isArray(body?.selected_frameworks)
    ? body.selected_frameworks.map((n: any) => Number(n)).filter((n: number) => !isNaN(n))
    : [];
  const presetPlan: any[] | null = Array.isArray(body?.preset_plan) ? body.preset_plan : null;

  const productMode: "affiliate" | "manual" =
    body?.product_mode === "manual" ? "manual" : "affiliate";
  const productUrl = String(body?.product_url || "").trim();
  const productUrlsAll: string[] = Array.isArray(body?.product_urls_all)
    ? body.product_urls_all.map(String)
    : [];
  const productImageUrl = String(body?.product_image_url || "").trim();
  const manualProducts: { info: string; imageData: string }[] = Array.isArray(
    body?.manual_products
  )
    ? body.manual_products
    : [];
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

  // Validate
  if (planMode !== "manual" && planMode !== "approved" && selectedFrameworks.length === 0) {
    return NextResponse.json(
      { error: "Select at least 1 framework" },
      { status: 400 }
    );
  }
  if (productMode === "affiliate" && !productUrl && !productImageUrl) {
    return NextResponse.json(
      { error: "Paste a product URL or upload a product image" },
      { status: 400 }
    );
  }
  if (productMode === "manual" && manualProducts.length === 0) {
    return NextResponse.json(
      { error: "Manual mode needs at least 1 product" },
      { status: 400 }
    );
  }
  if (planMode === "manual" && (!presetPlan || presetPlan.length === 0)) {
    return NextResponse.json(
      { error: "Manual plan mode needs a preset_plan array" },
      { status: 400 }
    );
  }

  // Pre-flight credit check — total = N × video rate (master plan is free).
  // Verify mode skips credit check until /approve fires the actual gens.
  const videoRate = await priceFor(
    user.id,
    durationMode === "16" ? "video_16s" : "video_8s"
  );
  const totalCost = videoRate * quantity;
  if (planMode !== "verify") {
    if (!(await hasEnoughCredits(user.id, totalCost))) {
      return NextResponse.json(
        { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
        { status: 402 }
      );
    }
  }

  // Resolve CTA copy per video idx (shop rotation, custom, or none).
  function ctaForVideo(idx: number, framework: Framework | null): string {
    if (ctaMode === "none") return "no explicit call-to-action — let dialog feel organic";
    if (ctaMode === "custom" && customCta.trim()) return `must include: "${customCta.trim()}"`;
    // Shop default — rotate the 30-line yellow-bag pool by idx
    const cta = SHOP_CTA_VARIATIONS[idx % SHOP_CTA_VARIATIONS.length];
    return `say verbatim in last 2 seconds: "${cta}"`;
  }

  // Persona constraint shared across the batch
  const personaParts: string[] = [];
  if (avatarGender !== "auto") personaParts.push(avatarGender === "male" ? "Malay man" : "Malay woman");
  else personaParts.push("Malay creator");
  if (avatarHijab !== "auto") personaParts.push(avatarHijab === "hijab" ? "wearing a hijab" : "not wearing a hijab");
  if (avatarAge !== "auto") personaParts.push(`in their ${avatarAge.replace("s", "")}s`);
  const personaConstraint = personaParts.join(", ");

  // ── Build per-video framework rotation ──
  // Each video index gets a framework from the user's selected pool.
  // Rotates with modulo so 5 videos × 3 frameworks = [F0, F1, F2, F0, F1].
  const frameworkRotation: Framework[] = [];
  if (planMode !== "manual" && planMode !== "approved") {
    for (let i = 0; i < quantity; i++) {
      const fwId = selectedFrameworks[i % selectedFrameworks.length];
      const fw = FRAMEWORKS.find((f) => f.id === fwId) || FRAMEWORKS[0];
      frameworkRotation.push(fw);
    }
  }

  // ── Plan generation (skipped for manual + approved modes) ──
  let plans: Array<{ framework?: string; prompt: string; caption?: string }> = [];

  if (planMode === "manual" || planMode === "approved") {
    plans = (presetPlan || []).slice(0, quantity).map((p: any) => ({
      framework: p.framework || "Custom",
      prompt: String(p.prompt || ""),
      caption: p.caption ? String(p.caption) : "",
    }));
    if (plans.length === 0 || plans.every((p) => !p.prompt)) {
      return NextResponse.json({ error: "preset_plan has no usable prompts" }, { status: 400 });
    }
  } else {
    // Optional product OCR pass when image present
    let productMeta: any = null;
    if (productImageUrl) {
      const ocr = await orChatVision({
        modelKey: "model_product_ocr",
        systemPrompt:
          "You are a product label reader. Output ONLY valid JSON. Keys: main_text, subtitle, logo_description, package_color. Empty string if unknown.",
        textPrompt:
          'Read the product packaging. Return JSON only: {"main_text":"","subtitle":"","logo_description":"","package_color":""}.',
        images: [productImageUrl],
        temperature: 0.1,
        maxTokens: 400,
      });
      if (ocr.ok && ocr.content) {
        try {
          const s = ocr.content.indexOf("{");
          const e = ocr.content.lastIndexOf("}");
          if (s >= 0 && e > s) productMeta = JSON.parse(ocr.content.substring(s, e + 1));
        } catch {}
      }
    }

    // Build the framework rotation block — one line per video showing the
    // framework name, focus, shot1/shot2 directions, emotion arc, and CTA.
    const rotationBlock = frameworkRotation
      .map((fw, i) => {
        const cta = ctaForVideo(i, fw);
        return `Video ${i + 1} — ${fw.name} (${fw.type.toUpperCase()})
  focus: ${fw.focus}
  shot1 (0-8s): ${fw.shot1}
  shot2 (${durationMode === "16" ? "8-16s" : "CTA"}): ${fw.shot2}
  emotion arc: ${fw.emotion}
  CTA: ${cta}`;
      })
      .join("\n\n");

    const productLockBlock = productMeta?.main_text
      ? `\n\nPRODUCT LOCK (mandatory in every prompt):\n- Package main text: "${productMeta.main_text}"${productMeta.subtitle ? `\n- Subtitle: "${productMeta.subtitle}"` : ""}${productMeta.logo_description ? `\n- Logo: ${productMeta.logo_description}` : ""}\n- Product MUST stay pixel-identical to reference: same exact text, logo, colors, layout. Sharp focus on label.`
      : "";

    const is16s = durationMode === "16";

    const systemPrompt = `You are Aisyah — Malaysia's #1 TikTok Shop Content Strategist. You plan viral TikTok Shop content that feels like a real kawan sharing, never like an ad.

<content_settings>
Total videos: ${quantity}
Duration: ${is16s ? "16s — ONE continuous story split into 2 shots (Shot 1: 0-8s, Shot 2: 8-16s)." : "8s — one single shot"}
Character: ${personaConstraint}
Aspect ratio: ${aspectRatio}
Market: Malaysian TikTok (Malay-speaking, informal)
</content_settings>

<framework_rotation>
You MUST follow this exact rotation — each video sticks to its assigned framework:

${rotationBlock}
</framework_rotation>

<no_image_mode>
Video model receives only the product image as reference (no avatar image). FORBIDDEN phrases: "same person from reference image", "same appearance", "holding the same product" → use "holding the product".
</no_image_mode>

<dialog_style_rules>
ALL dialog MUST sound like a real Malaysian friend talking — never like a script:
- Use: korang, aku, tau, kan, ni, tu, macam, serious, confirm, memang, gila
- Add fillers: "eh korang", "serious ni", "tau tak", "jap jap"
- Mix English naturally: "best gila", "confirm berbaloi", "game changer"
- NEVER use formal: saya, anda, tuan, puan
- Each video has a DIFFERENT speaking style (excited / whispering / storytelling / urgent / casual / hyped)
</dialog_style_rules>

<prompt_structure>
Each video prompt is a single paragraph (NOT bracketed sections), 600-1400 chars. Include:
1. Shot type + framing line ending: "BOTH HANDS FULLY VISIBLE IN FRAME — do NOT crop hands out of frame."
2. Character: "${personaConstraint}, attractive and ${avatarGender === "male" ? "handsome" : "beautiful"}, age ${avatarAge}"
3. Voice + delivery: "Malay ${avatarGender === "male" ? "man" : "woman"} voice in their ${avatarAge}, [tone matching framework's emotion arc]. Delivery: [excited / whispered / storytelling / urgent / teasing / deadpan / confession / hyped]."
4. Setting: scene that fits product use case + 1 sensory detail (sound / air / texture)
5. Spoken dialog with timestamps (LOCAL to each shot):
   - 0-2s hook: max 6 words Malay
   - 2-6s middle: max 14 words Malay
   - 6-8s CTA: max 6 words Malay${is16s ? " (CTA only in Shot 2)" : ""}
6. LIP-SYNC LOCK: "Character's mouth visibly opens and closes in sync with every Malay word. Clear lip articulation, teeth visible on open consonants. Mouth never stays closed while audio plays."
7. ANATOMY + VOICE LOCK: "2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin. Audio: ONE single voice only, no background voices, no chatter."
8. PRODUCT LOCK (twice): "Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift."${productLockBlock ? " Use OCR'd label exactly: " + (productMeta?.main_text ? `\"${productMeta.main_text}\"` : "as shown") + "." : ""}
9. UGC AUTHENTICITY LOCK: "Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter, relaxed body language."
10. AUDIO + VISUAL LOCK: "Speaks directly to camera. NO background music, NO instrumental, NO SFX. Spoken dialog only. NO subtitles, captions, overlays. RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags. 'beg kuning' is SPOKEN ONLY — never a yellow bag icon."
11. NEGATIVE: "Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot, staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions."
</prompt_structure>

OUTPUT: Return ONLY a JSON array of ${quantity} objects in framework order. Each object: { "framework": "<framework name from rotation>", "prompt": "<single paragraph>", "caption": "<short Malay TikTok caption with 2-4 hashtags>" }. NO markdown.`;

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
          maxTokens: Math.min(40000, quantity * 2000),
        })
      : await orChat({
          modelKey: "model_auto",
          systemPrompt,
          userPrompt,
          temperature: 0.85,
          maxTokens: Math.min(40000, quantity * 2000),
        });
    if (!plan.ok || !plan.content) {
      return NextResponse.json({ error: plan.error || "Master plan failed" }, { status: 502 });
    }

    // Parse JSON array (with truncation recovery)
    try {
      let cleaned = plan.content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start >= 0 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
      } else if (plan.finishReason === "length") {
        const lastClose = cleaned.lastIndexOf("},");
        if (lastClose > 0) cleaned = cleaned.substring(0, lastClose + 1) + "]";
      }
      const parsed = JSON.parse(cleaned);
      plans = Array.isArray(parsed)
        ? parsed.slice(0, quantity).map((p: any, i: number) => ({
            framework:
              p.framework || frameworkRotation[i]?.name || `Video ${i + 1}`,
            prompt: String(p.prompt || ""),
            caption: p.caption ? String(p.caption) : "",
          }))
        : [];
    } catch (e: any) {
      return NextResponse.json(
        { error: `Master plan parse failed: ${e?.message}` },
        { status: 502 }
      );
    }

    if (plans.length === 0) {
      return NextResponse.json({ error: "Empty master plan" }, { status: 502 });
    }
  }

  // ── Verify mode → return plan, don't fire Veo ──
  if (planMode === "verify") {
    return NextResponse.json({
      ok: true,
      mode: "verify",
      plan: plans,
      quantity: plans.length,
      total_cost_if_approved: videoRate * plans.length,
    });
  }

  // ── Fire N Veo r2v generations in parallel ──
  const admin = createAdminClient();
  const cfg = await getP2Config();

  // Pick the per-video product image: rotate manualProducts[i % len] OR
  // fall back to single productImageUrl (affiliate or single-product).
  function imageForVideo(i: number): string {
    if (productMode === "manual" && manualProducts.length) {
      return manualProducts[i % manualProducts.length].imageData;
    }
    return productImageUrl;
  }

  const { data: batch } = await admin
    .from("batches")
    .insert({
      user_id: user.id,
      project_id: projectId,
      product_url: productUrl,
      product_name: productName,
      product_image_url: productImageUrl,
      quantity: plans.length,
      duration_mode: durationMode,
      cta_mode: ctaMode,
      custom_cta: ctaMode === "custom" ? customCta || null : null,
      avatar_gender: avatarGender,
      avatar_hijab: avatarHijab,
      avatar_age: avatarAge,
      status: "generating",
      master_plan: plans,
    })
    .select()
    .single();

  const histories: any[] = [];
  await Promise.all(
    plans.map(async (item, idx) => {
      const refImage = imageForVideo(idx);
      const useIngredient = !!refImage;
      const model = useIngredient ? cfg.videoR2V : cfg.videoT2V;

      const created = await p2CreateTask({
        model,
        prompt: item.prompt,
        imageUrls: refImage ? [refImage] : [],
        durationMode,
        aspectRatio,
        imageMode: useIngredient ? "ingredient" : "text",
      });

      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: item.prompt,
          caption: item.caption || "",
          framework: item.framework || `Video ${idx + 1}`,
          reference_url: refImage || null,
          task_id: created.task_id || null,
          duration: durationMode === "16" ? 16 : 8,
          cost: videoRate,
          batch_id: batch?.id,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: { idx, model, batch_id: batch?.id, framework: item.framework, imageMode: useIngredient ? "ingredient" : "text" },
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
    quantity: plans.length,
    total_cost: videoRate * plans.length,
  });
}
