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

  // 1b. Master plan via OpenRouter — verbatim port of creative-hack-auto's
  //     apiMasterPlan prompt for no-image / auto-avatar mode (the only mode
  //     we run). Includes scene/framing/delivery menus, mandatory action-
  //     framing distribution, diversity rules, lip-sync lock, UGC auth lock,
  //     audio+visual lock, and the negative directive line.
  const minActionCount = Math.ceil(quantity * 0.4);
  const is16s = durationMode === "16";
  const ageReadable = avatarAge === "auto" ? "30s" : avatarAge;
  const characterBlock =
    `attractive and ${avatarGender === "male" ? "handsome Malay man" : "beautiful Malay woman"}, age ${ageReadable}, ` +
    (avatarHijab === "hijab"
      ? "wearing hijab and modest long-sleeve outfit (planner picks color + pattern)"
      : avatarHijab === "no-hijab"
        ? "casual modern outfit, hair visible, no hijab"
        : "neat casual outfit");
  const voiceBlock =
    `Malay ${avatarGender === "male" ? "man" : "woman"} voice in ${avatarGender === "male" ? "his" : "her"} ${ageReadable}, ` +
    (avatarGender === "male"
      ? "confident warm tone, casual pace, mid-range pitch."
      : "warm friendly tone, casual pace, mid-range pitch.") +
    " Clear studio recording, crisp consonants, no muffling.";

  const systemPrompt = `You are Aisyah — Malaysia's #1 TikTok Shop Content Strategist. You plan viral TikTok Shop content that feels like a real kawan sharing, never like an ad.

<content_settings>
Total videos: ${quantity}
Duration: ${is16s ? "16s — ONE continuous story split into 2 shots (Shot 1: 0-8s, Shot 2: 8-16s). NOT two separate videos. Same scene, same voice, story continues seamlessly." : "8s — one single shot"}
Character: ${characterBlock}
Voice: ${voiceBlock}
CTA: ${ctaInstruction}
Aspect ratio: ${aspectRatio}
Market: Malaysian TikTok (Malay-speaking, informal)
</content_settings>

<no_image_mode>
The video model receives ONLY the product image as a reference (no avatar image). Prompts must be self-contained and must NOT reference a "person reference image" (there is none). FORBIDDEN phrases: "same person from reference image", "same appearance", "holding the same product" → use "holding the product".
</no_image_mode>

<scene_menu>
- inside parked car (driver seat, daylight through windshield, steering wheel in bokeh)
- gym bench after workout (water bottle, sunset through tall windows, dumbbells in bokeh)
- kitchen counter prepping food (warm pendant light, cutting board + ingredients)
- bedroom vanity morning routine (ring light glow, skincare bottles, mirror behind)
- cafe table window seat (late afternoon daylight, latte + plant in bokeh)
- living room sofa cozy evening (warm table lamp, throw pillow, TV glow in bokeh)
- office desk midday (cool daylight, laptop + notebook in bokeh)
- bathroom vanity mirror (bright morning tile, skincare on counter)
- dining table dinner setup (candle + pendant warm glow, plates in soft focus)
- balcony outdoor golden hour (plants + railing, warm sunset wash)
- bedroom bedside evening (lamp bokeh, pillows behind, cozy cocoon feel)
- walk-in closet morning (soft white daylight, hanging clothes behind)
- hawker stall / food court (evening warm lights, bustling bokeh)
- poolside lounge chair (daylight, water shimmer in bokeh)
- at the beach (sand + waves in bokeh, golden hour wash)
- grocery store aisle (bright fluorescent, shelves in bokeh)
</scene_menu>

<framing_menu>
STATIC framings (character posed, product centered):
- holding product at chest level with both hands, label facing camera
- holding product up near face with one hand, showing scale next to cheek
- product placed on table foreground, hands gesturing naturally behind it
- one hand holding product at waist while other hand gestures expressively
- product resting beside her on the surface, she points at it with index finger
- extreme close-up of product in hand, tilted 15° toward camera
- product held up to catch lighting (window light, lamp, or sunset rim-light)
- sitting with product in lap, one hand cradling, other hand gesturing

ACTION framings (character mid-activity that matches product use — authentic UGC):
- cooking — stirring a pot / chopping mid-action, product visible on counter
- walking through scene — natural stride, product casually in one hand
- driving — one hand on steering wheel, product on dashboard or seat in frame
- running / jogging outdoors — mid-stride, product in belt holster or hand
- exercising at gym — mid-rep or between sets, product on bench
- sweeping floor / housework — mid-sweep, product on nearby shelf in bokeh
- brushing teeth / washing face at sink — mid-action, product on vanity
- folding laundry / tidying — hands busy with fabric, product on table foreground
- unpacking groceries — product emerging from bag in a natural reveal gesture
- sitting at cafe / eating snack — one hand with food/drink, product on table
- getting dressed / styling hair — mid-action, product on vanity as they prep
- gardening / watering plants — mid-action outdoors, product on ledge in frame

MANDATORY FRAMING DISTRIBUTION (enforce across this batch):
At least ${minActionCount} of the ${quantity} videos MUST use ACTION framings. The rest use STATIC. Pure-static batches feel like ads — the action mix creates authentic UGC feel.

RULE FOR ACTION FRAMINGS (Veo handles actions poorly if over-described):
- Describe ONE continuous state ("character IS cooking", not "walks to kitchen and starts cooking")
- Action must be SEMANTICALLY RELEVANT to product use (food → cooking/eating, supplement → gym, skincare → vanity, perfume → driving, deodorant → running, cleaner → sweeping)
- Action must NOT require moving the product (product stays visible — no hand-off, no pick-up mid-shot)
- Dialog still spoken directly to camera — character glances at camera while mid-action
</framing_menu>

<delivery_menu>
- excited energetic — bubbly fast-paced bright tone
- whispered secret — confidential low-volume, slight lean toward camera
- storytelling calm — slow narrative reflective pacing
- urgent warning — emphatic fast slightly-concerned tone
- teasing playful — winking tone with small smirk
- deadpan factual — matter-of-fact serious authoritative
- confession-style — vulnerable honest tone, looking slightly off-camera then back
- hyped reviewer — loud excited hype like reviewing a must-buy
</delivery_menu>

<dialog_style_rules>
ALL dialog MUST sound like a real Malaysian friend talking — NEVER like a script:
- Use: korang, aku, tau, kan, ni, tu, macam, serious, confirm, memang, gila
- Add fillers: "eh korang", "serious ni", "tau tak", "jap jap", "aku nak share ni"
- Speak like texting: incomplete sentences OK, reaction words OK
- Mix English naturally: "best gila", "confirm berbaloi", "serious game changer"
- NEVER use formal: saya, anda, tuan, puan, selamat sejahtera
- Each video has a DIFFERENT speaking style (excited / whispering / storytelling / urgent / casual)
</dialog_style_rules>

<diversity_rules>
- Every video MUST use a different scene + framing + delivery tuple
- Vary the hook angle (problem-agitate, curiosity, social proof, before-after, fear, aspiration, urgency, authority)
- Match scene to product use case (food → kitchen, skincare → vanity, perfume → car/outing, supplement → gym, etc.)
</diversity_rules>

<prompt_structure>
Each video prompt is a single paragraph (NOT bracketed sections), 600-1400 chars, containing in order:

1. ONE shot-type + framing line ending: "BOTH HANDS FULLY VISIBLE IN FRAME — do NOT crop hands out of frame."
2. Character: "${characterBlock}"
3. Voice + delivery: "${voiceBlock} Delivery: [pick from delivery_menu]."
4. Setting: "[scene from scene_menu]. [1 extra sensory detail — sound ambience / air quality / texture]"
5. Spoken dialog (timestamps LOCAL to each 8s shot):
   - 0-2s hook: max 6 words Malay
   - 2-6s middle: max 14 words Malay
   - 6-8s CTA: max 6 words Malay${is16s ? " (for 16s, CTA only in Shot 2; Shot 1's 6-8s is mid-story)" : ""}
6. LIP-SYNC LOCK: "Character's mouth visibly opens and closes in sync with every Malay word. Clear lip articulation, teeth and tongue visible on open-mouth consonants. Mouth NEVER stays closed while audio plays."
7. ANATOMY + VOICE LOCK: "Anatomically perfect: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no distorted features, no plastic skin. Audio: ONE single voice only, no background voices, no chatter."
8. PRODUCT LOCK (twice — once in setting, once at end): "Product is pixel-identical to the product reference — same exact color, shape, label, typography, packaging. Product stays SHARP and in focus, label readable, no motion blur, no warping, no recoloring, no text drift."${productLockBlock ? " Use the OCR'd label exactly: " + (productMeta?.main_text ? `\"${productMeta.main_text}\"` : "as shown") + "." : ""}
9. UGC AUTHENTICITY LOCK: "Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with visible pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter, relaxed casual body language, faint room ambience."
10. AUDIO + VISUAL LOCK (highest priority): "Speaks directly to camera with clear voice. NO background music, NO instrumental, NO SFX. Spoken dialog only. NO subtitles, captions, or text overlays. RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, auto-dialog text, TikTok-style animated captions, sticker text, icons, emojis, graphics, overlays, watermarks, UI elements, handles, hashtags. 'beg kuning' is SPOKEN DIALOG ONLY — never a yellow bag icon, shopping graphic, or visual element. Frame shows ONLY the person, the product, and the real-world setting."
11. NEGATIVE: "Negative: cartoon rendering, 3D cartoon, anime, airbrushed plastic skin, uncanny valley face, glam makeup, salon-perfect hair, softbox studio lighting, tripod static shot, staged clean background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, floating hands, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, icon overlays."
</prompt_structure>

OUTPUT: Return ONLY a JSON array of ${quantity} plan objects. Each object: { "framework": "<one of: PAS / AIDA / BAB / FAB / Curiosity / Fear / Aspiration / Social Proof>", "prompt": "<single-paragraph Veo prompt as structured above>", "caption": "<short TikTok caption in Malay, 1-2 sentences with 2-4 hashtags>" }. NO markdown, NO commentary, NO bracketed sections inside prompt — just the paragraph.`;

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
