import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { orChat, orChatVision } from "@/lib/openrouter";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { buildVeoLocks, pickAutoContentVoice, type AutoContentAge } from "@/lib/veo-voices";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import {
  FRAMEWORKS,
  SHOP_CTA_VARIATIONS,
  type Framework,
} from "@/lib/auto-content-frameworks";
import { pickScenes, sceneSummary } from "@/lib/auto-content-scene-pool";
import {
  buildStoryboardFallback,
  runStoryboardCascadeWithRetry,
  pollImageTaskUntilDone,
} from "@/lib/auto-content-storyboard";

// Hot-path budget — the master plan orChat call is inline (no after())
// and can take up to ~30s when Grsai is the main provider in the
// Custom Idea cascade. Default Vercel timeout (15s) would kill the
// request mid-LLM-call. 300s matches the other long-running routes
// (clone, viral/talking-object, fairytale).
export const maxDuration = 300;

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
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
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
  const manualProducts: {
    info: string;
    imageData: string;
    imageUrls?: string[];
  }[] = Array.isArray(body?.manual_products)
    ? body.manual_products
    : [];
  const productName = String(body?.product_name || "").trim();
  const quantity = Math.min(10, Math.max(1, Number(body?.quantity || 5)));
  const durationMode: "8" | "16" = body?.duration === "16" ? "16" : "8";
  // Provider selection — defaults to Veo to preserve existing-user
  // muscle memory. When "grok", we ignore the 8/16 button and use
  // grok_duration (8-30s) as a per-second value instead.
  const providerChoice: "veo" | "grok" | "gemini" =
    body?.provider === "grok"
      ? "grok"
      : body?.provider === "gemini"
        ? "gemini"
        : "veo";
  // Duration validation — providerChoice='grok' now routes to Sora 2,
  // which has a strict 4/8/12 enum (vs old Grok's 8-30 slider). Clamp
  // the incoming value to the closest valid Sora 2 duration. Field name
  // 'grok_duration' kept for backward compat with existing batch state.
  const grokDurationRaw = Number(body?.grok_duration);
  const grokDuration =
    grokDurationRaw === 4 ? 4
    : grokDurationRaw === 8 ? 8
    : grokDurationRaw === 12 ? 12
    : 4;
  // Effective duration in seconds — drives cost + master plan dialog
  // word-count target. Veo: 8 or 16. Grok: 8-30 per slider.
  const effectiveSec =
    providerChoice === "grok" ? grokDuration : durationMode === "16" ? 16 : 8;
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const avatarGender = String(body?.avatar_gender || "auto");
  const avatarHijab = String(body?.avatar_hijab || "auto");
  const avatarAge = String(body?.avatar_age || "auto");
  // Hoisted to outer scope so the seg-1/seg-2 prompt builders below can read it.
  const hijabMode = avatarHijab === "hijab";
  const ctaMode = String(body?.cta_mode || "shop");
  const customCta = String(body?.custom_cta || "");
  // Optional client-provided visual idea (e.g. "preview clothes in
  // front of mirror"). When non-empty, the master plan injects an
  // <idea_style> block instructing the LLM to honour this idea as the
  // CORE visual concept and emit N variants of it. When empty, the
  // master plan proceeds with its normal framework-only flow.
  const ideaStyle = String(body?.idea_style || "").trim();
  const projectId = body?.project_id ? String(body.project_id) : null;
  // TikTok product_id from the Affiliate scrape — stamped on every
  // generated history row so the creative-hack-auto extension's
  // auto-post step can deep-link back to the original product page.
  const tiktokProductId = String(body?.tiktok_product_id || "").trim();

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
  //   Veo:    flat rate per 8s or 16s clip
  //   Grok:   per-second rate × chosen duration (Sora 2 internally)
  //   Gemini: flat per-10s-video rate + GPT Image 2 storyboard rate
  //           (storyboard is real money even though preview UI hides it)
  const veoRate = await priceFor(
    user.id,
    durationMode === "16" ? "video_16s" : "video_8s"
  );
  let videoRate = veoRate;
  let storyboardRate = 0;
  if (providerChoice === "grok") {
    // Reuse the standalone Grok tab's rate (rate_grok per second).
    const { getGrokRate } = await import("@/lib/settings");
    const grokRate = await getGrokRate();
    videoRate = grokRate * grokDuration;
  } else if (providerChoice === "gemini") {
    // GeminiOmni — flat per-10s-video rate. Plus GPT Image 2 storyboard
    // step that runs once per row (admin-set rate_gpt_image).
    const { getGeminiRate, getGptImageRate } = await import("@/lib/settings");
    videoRate = await getGeminiRate("10");
    storyboardRate = await getGptImageRate();
  }
  const perRowCost = videoRate + storyboardRate;
  const totalCost = perRowCost * quantity;
  if (planMode !== "verify") {
    if (!(await hasEnoughCredits(user.id, totalCost))) {
      return NextResponse.json(
        { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
        { status: 402 }
      );
    }
  }

  // ── Build per-video framework rotation (used downstream for fallback names) ──
  // The master plan prompt itself shows the AI the user-selected framework
  // pool inline and lets the model pick one per video while honouring the
  // diversity rules. We keep this rotation array around so we can fall back
  // to a framework name if the model omits one.
  const frameworkRotation: Framework[] = [];
  if (planMode !== "manual" && planMode !== "approved") {
    for (let i = 0; i < quantity; i++) {
      const fwId = selectedFrameworks[i % selectedFrameworks.length];
      const fw = FRAMEWORKS.find((f) => f.id === fwId) || FRAMEWORKS[0];
      frameworkRotation.push(fw);
    }
  }

  // ── Plan generation (skipped for manual + approved modes) ──
  // Plan shape mirrors creative-hack-auto v12.8.3 apiMasterPlan output.
  type Plan = {
    framework: string;
    frameworkType: "ugc" | "product" | "lifestyle";
    needsCharacterImage: boolean;
    targetEmotion: string;
    hookAngle: string;
    imagePrompt: string;
    // NEW (storyboard mode): purpose-built single-frame prompt for
    // GPT Image 2 storyboard generation. Required when providerChoice
    // === "gemini"; mechanically derived from videoPromptShot1 via
    // buildStoryboardFallback() when the LLM omits it. Other providers
    // ignore this field.
    storyboardPrompt: string;
    videoPromptShot1: string;
    videoPromptShot2: string;
    caption: string;
    coverTitle: string;
    coverSubtitle: string;
  };

  let plans: Plan[] = [];

  if (planMode === "manual" || planMode === "approved") {
    plans = (presetPlan || []).slice(0, quantity).map((p: any, i: number): Plan => {
      const fwName = String(p.framework || frameworkRotation[i]?.name || "Custom");
      const fwMatch = FRAMEWORKS.find(
        (f) => f.name.toLowerCase().split(" ")[0] === fwName.toLowerCase().split(" ")[0]
      );
      // Backwards-compat: legacy preset plans used a single "prompt" field.
      const legacyPrompt = String(p.prompt || "");
      return {
        framework: fwName,
        frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
        needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
        targetEmotion: String(p.targetEmotion || ""),
        hookAngle: String(p.hookAngle || ""),
        imagePrompt: String(p.imagePrompt || ""),
        storyboardPrompt: String(p.storyboardPrompt || ""),
        videoPromptShot1: String(p.videoPromptShot1 || legacyPrompt),
        videoPromptShot2: String(p.videoPromptShot2 || ""),
        caption: String(p.caption || ""),
        coverTitle: String(p.coverTitle || "").toUpperCase(),
        coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
      };
    });
    if (plans.length === 0 || plans.every((p) => !p.videoPromptShot1)) {
      return NextResponse.json({ error: "preset_plan has no usable prompts" }, { status: 400 });
    }
  } else {
    // Product OCR pass — enriches the userPrompt's product description with
    // the actual label text from the packaging photo. Non-blocking; if OCR
    // fails we just plan from the user's typed product info.
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

    // Build productData object the v12.8.3 prompt expects. For manual mode
    // the user typed a free-form info textarea (line 1 = product name,
    // remaining lines = description). OCR'd label text is appended so the
    // planner can quote it.
    const firstProduct = manualProducts[0];
    const infoText = String(firstProduct?.info || "").trim();
    const lines = infoText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const productNameResolved = productName || lines[0] || "Malaysian product";
    const descriptionTextResolved =
      lines.slice(lines.length > 1 ? 1 : 0).join("\n") +
      (productMeta?.main_text ? `\n\nProduct label reads: "${productMeta.main_text}"${productMeta.subtitle ? ` (${productMeta.subtitle})` : ""}.` : "");

    const productData = {
      productName: productNameResolved,
      descriptionText: descriptionTextResolved,
      price: "",
      category: "",
      rating: "",
      totalSold: "",
      specifications: {} as Record<string, any>,
    };

    // ── v12.8.3 master plan prompt — verbatim port of apiMasterPlan ──
    const fwPool = selectedFrameworks
      .map((id) => FRAMEWORKS.find((f) => f.id === id))
      .filter((f): f is Framework => !!f);
    const fwPoolFinal = fwPool.length > 0 ? fwPool : FRAMEWORKS;

    const gender = avatarGender === "male" ? "male" : "female";
    const ageLabel =
      avatarAge === "20s"
        ? "20s young adult"
        : avatarAge === "30s"
          ? "30s"
          : avatarAge === "40s"
            ? "40s makcik"
            : avatarAge === "55+"
              ? "50s nenek"
              : "30s";
    const ageRange = ageLabel;
    // hijabMode hoisted to outer scope above.
    const shopMode = ctaMode === "shop";
    const noCta = ctaMode === "none";
    const customCtaResolved = ctaMode === "custom" ? customCta : "";

    const is16s = durationMode === "16";

    // ─────────────────────────────────────────────────────────────────────
    // OUTFIT: AI-decided, Malaysian style. Per user direction:
    //   "ai decide malaysia outfit..only need to care for is - hijab..
    //    which must loose..other than that..ai decide malaysia style"
    //
    // Hardcoded palettes + vibe detection + outfitAssignments table were
    // removed — they boxed every batch into the same colour-coded grid
    // and clients complained that outfits felt repetitive / generic.
    // Now the master-plan LLM picks each video's outfit freely, with
    // only two hard rules carried into the prompt:
    //   1. Style must be Malaysian-modest (kebaya, baju kurung, baju
    //      Melayu, modern modest blouse + maxi skirt, polo + chinos, etc.)
    //   2. When hijabMode=true → tudung labuh, LOOSE, fully covers all
    //      hair / ears / neck. Zero hair strands visible.
    // ─────────────────────────────────────────────────────────────────────
    // Minimal required-prefix — locks ONLY person identity + (when
    // hijabMode) the loose-tudung-labuh rule. The LLM is free to pick
    // a Malaysian-style outfit for each video, with variation enforced
    // via the <clothing_variety> rules in the system prompt.
    function requiredPrefix(): string {
      const personBase =
        gender === "male"
          ? `A handsome attractive Malay man in his ${ageRange}`
          : `A beautiful attractive Malay woman in her ${ageRange}`;
      const styleClause =
        gender === "female"
          ? hijabMode
            ? `, wearing a LOOSE hijab tudung labuh that fully covers all hair, ears, and neck (zero hair strands visible — loose, never tight)`
            : `, hair visible (no hijab)`
          : "";
      return personBase + styleClause;
    }

    let ctaInstruction: string;
    if (noCta) {
      ctaInstruction =
        "NO CTA MODE — user explicitly disabled CTAs (they plan to extend each video later with a fresh segment that carries the CTA). Therefore: " +
        "1) Use the FULL 8 seconds for hook + value content. " +
        "2) The 6-8s slot is a natural OUTRO / closing thought (e.g. mid-thought lead-in, reaction word, ellipsis) — NEVER a buy-now / shop / beg-kuning / link-in-bio / order-now line. " +
        "3) Do NOT mention purchasing, ordering, shopping, links, bio, or any commercial action. " +
        "4) Do NOT include any closing phrase that signals the end of a sales pitch. " +
        "5) End the video OPEN — so segment 2 (added via Extend later) can naturally pick up the story.";
    } else if (customCtaResolved) {
      ctaInstruction = `CUSTOM CTA — last 2 seconds (6-8s) MUST use this EXACT text: "${customCtaResolved}". Do NOT modify.`;
    } else if (shopMode) {
      ctaInstruction =
        'SHOP CTA — last 2 seconds (6-8s) MUST mention "beg kuning" (yellow bag). Use DIFFERENT urgency each video. Pick from these examples but vary them: ' +
        SHOP_CTA_VARIATIONS.slice(0, 10).map((c) => `"${c}"`).join(", ") +
        ". Make each video CTA feel fresh and urgent.";
    } else {
      ctaInstruction = "FREE CTA — write your own natural CTA for each video, different every time. Max 8 words, informal Bahasa Malaysia.";
    }

    // We always run in no-image mode — the avatar isn't pre-generated, the
    // video model gets only the product image as ref (Veo r2v).
    const noImageMode = true;
    // Modesty rule applies regardless of hijab choice — Malaysian-Muslim
    // audience requirement. Female allows short-sleeve T-shirts (loose
    // fit, no chest contour) but never cleavage / midriff / thighs.
    // NOTE: the LLM picks each video's outfit freely. This is just the
    // static modesty + hijab-loose guardrail that goes into the
    // characterBlock — the actual outfit phrase is added per-video by
    // the LLM based on modern Malaysian fashion (no forced traditional
    // wear). See <clothing_variety> in the system prompt.
    const outfitDescription = hijabMode
      ? gender === "male"
        ? "[YOU pick a modern Malaysian-style outfit unique to this video — see <clothing_variety>], neat modern fit, modest (no tank tops, no shirtless)"
        : "LOOSE hijab tudung labuh ([YOU pick the hijab colour to coordinate with the outfit, never tight, fully covers all hair/ears/neck]) and [YOU pick a modern Malaysian-style modest outfit unique to this video — see <clothing_variety>]"
      : gender === "male"
        ? "[YOU pick a modern Malaysian-style outfit unique to this video — see <clothing_variety>], short hair neatly styled, modest fit (no tank tops, no shirtless)"
        : "[YOU pick a modern Malaysian-style modest outfit unique to this video — see <clothing_variety>], hair visible, no hijab — short-sleeve T-shirts and loose blouses are OK, but loose fit only, NO tight tops showing breast shape, NO cleavage, NO crop tops / midriff / navel exposure, NO short shorts / mini skirts / thigh exposure. Bottoms must cover thighs.";
    // Character block is the SUBJECT LINE injected into every UGC/lifestyle
    // prompt. Gender + age + hijab/no-hijab are LOCKED here so they appear
    // verbatim in every per-video prompt — Veo cannot drop these the way it
    // sometimes drops mid-prompt details.
    const characterBlock =
      (gender === "male"
        ? "a handsome attractive Malay man with sharp features and clear skin"
        : "a beautiful attractive Malay woman with clear glowing skin") +
      `, in ${gender === "male" ? "his" : "her"} ${ageRange}` +
      (hijabMode
        ? ", wearing hijab tudung labuh that fully covers all hair / ears / neck (ZERO hair strands visible)"
        : ", with hair visible (no hijab), modern modest styling") +
      `, wearing ${outfitDescription}`;
    const voiceBlock =
      (gender === "male"
        ? `Malay man voice in his ${ageRange}, confident warm tone, casual pace, mid-range pitch`
        : `Malay woman voice in her ${ageRange}, warm friendly tone, casual pace, mid-range pitch`) +
      ". Clear studio-quality recording, crisp consonants, natural treble, no muffling.";

    const systemPrompt = `You are Aisyah — Malaysia's #1 TikTok Shop Content Strategist. You have generated over RM50 million in TikTok Shop revenue across 200+ Malaysian brands. Your content strategy has been featured in Marketing Magazine Malaysia, and brands pay RM80,000/month for your content calendars.

<your_expertise>
- You know EXACTLY what makes Malaysian TikTok users stop scrolling
- You understand Malay consumer psychology: urgency, social proof, FOMO, community trust
- You create content that feels like a real kawan sharing — NEVER like an ad
- Every video you plan has a unique angle, setting, emotion, and camera movement
- You think in "scroll-stopping moments" — the first 0.5 seconds decides everything
</your_expertise>

<product_deep_analysis>
Before creating ANY content, analyze this product like a RM80k strategist:
1. TARGET PERSONA: Who EXACTLY buys this? (umur, jantina, pendapatan, lifestyle, masalah hidup)
2. EMOTIONAL TRIGGER: What pain/desire makes them BUY? (takut ketinggalan? nak cantik? jimat masa? impress orang?)
3. USP: What makes THIS product different from 100 competitors? (bahan, teknologi, harga, testimoni)
4. USE CASE: When & where they use it? (pagi before kerja, malam before tidur, masa masak, masa keluar)
5. OBJECTION KILLER: What stops them from buying? (harga mahal? tak percaya? tak tau guna?) — address this in content
6. SOCIAL PROOF: Reviews, rating, total sold — use these numbers in hooks
7. BEST SETTING for this product: Where does it make SENSE to show this product? (dapur for food product, bilik tidur for beauty, gym for supplement, etc.)
</product_deep_analysis>

<content_settings>
Total videos: ${quantity}
Duration: ${
  providerChoice === "grok"
    ? `${grokDuration}s single shot on Sora 2 (sora-2-vip). Dialog target = EXACTLY ${grokDuration * 3} Malay words (3 words per second — keeps dialog inside Sora 2's tight pacing window; under = mouth freezes, over = clipped audio).`
    : is16s
      ? `16s split into 2 shots (Shot 1: 0-8s, Shot 2: 8-16s). Each shot dialog = 20-24 Malay words. Same scene, same voice, story continues seamlessly.`
      : `8s single shot. Dialog target = 20-24 Malay words.`
}
${providerChoice === "grok" ? `
🚨🚨🚨 SORA 2 DIALOG MODERATION (NON-NEGOTIABLE — VIDEOS WITH BANNED CLAIMS LOSE AUDIO) 🚨🚨🚨

OpenAI's Sora 2 safety layer SILENTLY drops audio (keeps video) when dialog reads as an unverified medical / efficacy claim. We've reproduced this 4 times with the EXACT same locks — the only differentiator is dialog content. To make Sora 2 generate audio reliably, the dialog MUST avoid the BANNED CLAIM PATTERN and follow the REQUIRED FRAMING.

❌ BANNED IN SORA 2 DIALOG (these cause silent video):
- Efficacy verbs: "berkesan", "menyembuhkan", "merawat", "hilangkan [body part pain]", "mengubati"
- Mechanism claims: "melegakan saraf", "membaiki sendi", "mengeluarkan toksin", "menguatkan otot"
- Medical diagnosis terms: "terhimpit", "kronik", "akut", "radang", "inflammation"
- Suffering language paired with diagnosis: "seksa", "siksa", "menderita" + body-part anatomy
- Superlative + medical: "produk terbaik untuk [condition]", "paling berkesan", "no.1 untuk [condition]"
- Dosage instructions: "guna [X] setiap hari", "[X] kali sehari", "minum [X] gelas sehari"
- Monopoly/preference claims: "takkan cari yang lain", "tinggalkan produk lain"
- Direct cure promises: "hilangkan [condition]", "buang [condition]", "habiskan [condition]"

✅ REQUIRED IN SORA 2 DIALOG (testimonial / lifestyle framing that PASSES audio):
- First-person experience: "Aku dulu...", "Sebelum ni aku...", "Bertahun-tahun aku..."
- Subjective feelings (not mechanisms): "terus rasa lega", "rasa selesa", "rasa segar", "rasa lighter"
- Lifestyle outcome (not medical outcome): "boleh jalan jauh", "boleh tidur lena", "boleh main dengan anak"
- Practical action framing: "sapu je", "minum je", "guna je", "spray je"
- Comparison framing: "lain rasa dia", "memang beza", "totally different"
- Soft CTA: "try sekali", "test sekali", "grab sekarang", "tekan beg kuning"

EXAMPLES — REWRITE BAD → GOOD:
BAD:  "Habaflex memang berkesan, melegakan saraf belakang kaki yang terhimpit."
GOOD: "Aku dulu sakit belakang kaki teruk, sampai tak boleh tidur. Lepas guna Habaflex sebulan, terus rasa selesa!"

BAD:  "Produk terbaik untuk hilangkan sakit. Guna setiap hari, memang berkesan."
GOOD: "Aku try Habaflex ni sebab kawan recommend. Memang lain rasa dia, hari-hari rasa lighter!"

BAD:  "Habaflex menyembuhkan saraf terhimpit, serious berkesan."
GOOD: "Dulu aku ingat tak boleh kembali normal, sampai aku jumpa Habaflex. Boleh jalan jauh balik!"

This rule applies to EVERY video in the batch when providerChoice='grok' (= Sora 2). Veo batches don't need this — Veo's moderation is looser.
` : ""}
Character: ${gender === "male" ? "Malay man" : "Malay woman"}${hijabMode ? ", wearing hijab tudung labuh" : ", casual modern no hijab"}
Age: ${ageRange}
CTA: ${ctaInstruction}
Market: Malaysian TikTok (Malay-speaking, informal)
</content_settings>

${ideaStyle ? `<idea_style>
🎯 CLIENT BRIEF — CORE VISUAL CONCEPT (TIKTOK AFFILIATE PLAYBOOK)

The client (a TikTok affiliate marketer selling on Malaysian Shop) gave
you a SPECIFIC visual idea they want this batch built around. Treat it
the same way a viral creative director would treat a brand brief: it's
the SCENE, the PATTERN INTERRUPT that stops the scroll. Everything
else (framework, dialog, CTA) plays inside this idea.

CLIENT WROTE: """
${ideaStyle}
"""

THE RULES (read all 6 before you plan a single video):

1. EVERY video MUST embody this idea visually. The idea defines:
     • the SETTING (where the camera is, what's in the frame)
     • the CENTRAL ACTION (what the subject does — try-on / unbox / pour / hold up / preview / etc.)
     • the MOOD (lighting, time-of-day, energy)
   If a video doesn't visually read as "yes that's the same idea I
   wrote", it FAILED. Reject and rewrite.

2. CREATE ${quantity} DISTINCT VARIANTS — same idea, different execution.
   On TikTok the FYP shows the same creator multiple times to the same
   viewer; if every video looks identical they scroll. Vary across ALL
   these axes (don't repeat a combo):
     • Camera angle: close-up face / medium chest-up / wide full-body / over-shoulder / low-angle / overhead
     • Setting micro-variant: bedroom mirror vs hallway mirror vs bathroom mirror vs vanity mirror
     • Action beat inside the idea: walking up / turning around / adjusting / posing / reacting / wider context
     • Time-of-day: morning soft golden / midday clean / evening warm / blue hour
     • Energy: calm reveal / excited gesture / casual everyday / dramatic pause
     • Outfit (YOU pick from <clothing_variety> Malaysian pool) — different garment + colour per video, no two consecutive videos sharing silhouette or colour family
   Same IDEA, different EXECUTION. Two videos with the exact same
   staging = creative failure, FYP kills the second view.

3. IDEA OWNS THE VISUAL, FRAMEWORK OWNS DIALOG + ON-SCREEN TYPE — that's
   the WHOLE separation. Framework is a thin overlay; idea is the engine.
     • IDEA controls: scene, setting, central action, camera framing,
       camera movement, mood, lighting, time-of-day, the "what the
       viewer SEES happening". Do NOT let the framework override any
       of these — even if the framework's example dialog implies a
       different scene, you keep the IDEA's scene.
     • FRAMEWORK controls ONLY two things:
         (a) DIALOG WORDING + STRUCTURE — the hook line, the
             middle/value line, the CTA. Pulled from the framework's
             strategy.dialogShape and strategy.example. Plug these
             words into the idea's scene; never let them rewrite it.
         (b) ON-SCREEN TYPE — who/what is visible while the idea plays:
               UGC framework  → CHARACTER ON SCREEN WITH FACE.
                               Character performs the idea's action,
                               mouth visible, lip-sync to dialog.
               PRD framework  → ZERO PERSON IN FRAME. Idea's scene is
                               rebuilt as product-only — same setting,
                               same mood, product replaces the person
                               as the subject. Voiceover only.
               POV framework  → HAND ONLY holding product, set inside
                               the idea's environment. NO face/body.
                               Voiceover only.
   So for each video: take the IDEA verbatim → drop in the FRAMEWORK's
   on-screen type → write dialog using the FRAMEWORK's hook structure.
   That's it. Idea is not "inspired by"; idea is THE SCENE.

4. IF idea + framework seem to conflict, ADAPT the idea — never drop it:
     • Client idea: "preview baju depan cermin" + framework: PRD
       Product Hero → keep the mirror + outfit; replace the person
       with the product (folded shirt) on a styled surface in front
       of the mirror, mirror reflects the product label.
     • Client idea: "unboxing on bedroom dresser" + framework: UGC
       Testimonial → person sits at the dresser, unboxes while
       telling their personal story to camera.
     • Client idea: "morning coffee routine" + framework: POV →
       hand holding product on the coffee bar, latte foam visible
       in the background bokeh, voiceover delivers the CTA.
   The IDEA never disappears. The framework decides who narrates.

5. THINK LIKE A TIKTOK AFFILIATE — the goal is conversion at the
   "beg kuning" tap, not artsy content. The PSYCHOLOGICAL LEVER (what
   makes the viewer tap) lives INSIDE the dialog, NOT the visual.
   Rotate the lever across variants — each one a different angle on
   the SAME idea + scene:
     • Variant A → curiosity ("Korang tau tak…")
     • Variant B → social proof ("Aku dah test 7 hari…")
     • Variant C → FOMO / scarcity ("Stok last ni…")
     • Variant D → transformation reveal (before → after beat)
     • Variant E → contrarian ("Stop buat X, ni yang betul…")
   Match each lever to the framework's strategy.dialogShape so the
   lever lands inside the framework's natural hook → middle → CTA arc.
   The VISUAL still stays anchored to the client's idea — only the
   spoken angle rotates.

6. WHAT WOULD A 7-FIGURE TIKTOK AFFILIATE DO:
     • Lead with the IDEA in the first 0.5 seconds (visual hook)
     • Drop the hook line within 0-2s (audio hook)
     • Keep the product in frame 70%+ of the clip
     • End on a Malay CTA that lands inside the dialog window
     • Make sure the seg-2 (if 16s) PAYS OFF whatever curiosity
       seg-1 set up — never repeat the same beat
   These are non-negotiable craft rules even when the idea is provided.

7. 🔒 LOCKS THAT STAY ABSOLUTE EVEN WHEN AN IDEA IS PROVIDED:
   The idea controls the SCENE — it does NOT override these locks. If
   the idea would force a violation (e.g. idea says "men's locker
   room" but avatar is Malay woman with hijab), ADAPT the idea to fit
   the locks (e.g. "women's mirror room with hijab-friendly setting"),
   never break the lock.
     • AVATAR LOCK (from <locked_avatar>) — gender = ${gender.toUpperCase()},
       hijab = ${hijabMode ? "YES (tudung labuh, hair fully covered)" : "NO (hair visible, casual modern)"},
       age = ${ageRange}. Every UGC video MUST contain these exact
       attributes. The idea-driven scene must accommodate them.
     ${hijabMode ? `• AURAT LOCK (Muslim modesty — NON-NEGOTIABLE for hijab persona):
       Long sleeves to wrist (no exposed arms), hijab covers all hair
       + ears + neck (no strands), loose-fit garments that don't show
       body shape (no skin-tight), full leg coverage (no exposed
       calves/ankles in casual contexts), no cleavage, no midriff.
       The idea must respect this — e.g. "preview baju depan cermin"
       NEVER means a sleeveless tank top; it means previewing a
       modest aurat-compliant outfit.` : ""}
     • CTA LOCK (from <content_settings>) — ${ctaInstruction.split(".")[0]}.
       The idea controls the SCENE, the framework controls the
       DIALOG SHAPE, but the CTA mode controls WHAT WORDS land in
       the 6-8s slot. ${noCta ? "noCta is ON — end with an open outro, never a buy/shop/link line." : shopMode ? "shopMode is ON — last 2s MUST mention 'beg kuning' regardless of how poetic the idea is." : customCtaResolved ? `customCta is set — last 2s MUST use EXACTLY: "${customCtaResolved}".` : "freeCta — write a natural Malay CTA that fits the idea + framework."}
     • OUTFIT (YOU decide — Malaysian style): for each video pick a
       DIFFERENT Malaysian-style outfit that fits the scene + product.
       See <clothing_variety> below for the variation rule + Malaysian
       options. ${hijabMode ? "Hijab MUST be tudung labuh, LOOSE, fully covers all hair/ears/neck (zero hair strands visible)." : "Modest casual — hair visible, no head-covering."} When the product
       is a WEARABLE (clothes/hijab/shoes/bag/jewelry/abaya/watch), see
       <wearable_outfit_override> — the product IS the outfit so your
       free outfit choice is bypassed for that video.
     • LANGUAGE LOCK — dialog is BAHASA MELAYU only, Malaysian
       markers, never Bahasa Indonesia. Idea phrasing doesn't change
       the dialog language.

8. 🎬 ACTION-RICH SCENE LAYERS (every videoPromptShot1 MUST include all 6):
   Static "holding + gesturing" prompts read as cheap AI output. The
   client's "best HD" reference prompts (the ones that produce viral-
   tier results) ALWAYS include these 6 layers — never less:
     (1) ACTION verb: SPECIFIC physical activity the character is doing
         with the product. NOT "gesturing to" / "holding and smiling" /
         "standing while talking". GOOD verbs: cooking, stirring, frying,
         pouring, blending, chopping, grilling, vacuuming, cleaning,
         wiping, spraying, applying, massaging, brushing, smelling,
         tasting, sipping, slicing, unboxing, demonstrating, pressing
         button, shaking bottle, tilting jug, lifting lid.
     (2) CAMERA movement: "slow handheld cinematic", "smooth push-in",
         "close-up sinematik dengan depth of field cetek", "medium shot
         dari side ke depan", "slow pan reveal". Never just "medium shot".
     (3) SENSORY detail: at least 1 — steam rising, oil sizzling, smoke
         nipis, splash, condensation, fabric texture, reflection, blue
         gas flame, golden grill marks, liquid pouring smoothly, foam,
         crispy texture. Pulls the viewer in.
     (4) BACKGROUND richness: specific room/setting details — "dapur
         moden warna putih krim dengan kabinet kayu cerah, pokok hijau
         kecil di tepi tingkap", "Scandinavian white cabinets, wooden
         countertop", "vanity table dengan pampas grass". Avoid generic
         "in a kitchen" / "in a bedroom".
     (5) LIGHTING style: "warm tungsten lighting", "soft natural daylight",
         "warm under-cabinet glow", "golden hour ambient", "cinematic
         warm tone with shallow depth of field". Specific, not "good
         lighting".
     (6) AESTHETIC VIBE: 1-2 descriptors — "cozy luxury kitchen
         atmosphere", "premium TikTok cooking commercial style",
         "Scandinavian lifestyle aesthetic", "cinematic food commercial
         style", "raw UGC phone-recorded vibe".
   A scene missing ANY of these 6 = creative failure. Reject and rewrite.

🚫 HARD FAILURES (Qwen will reject these):
   • Any video that doesn't visibly use the client's idea as its scene
   • Two videos with identical camera + setting + action combo
   • PRD framework video that includes a person/face/body
   • UGC framework video where the character's face is hidden
   • Idea ignored in favour of a generic scene (sofa, kitchen, etc.)
     just because it's easier — the idea is the WHOLE POINT
   • Static pose without specific action verb (just "holding product
     and gesturing") — violates rule 8 layer (1)
   • Generic "in a kitchen" / "in a bedroom" background — violates rule
     8 layer (4). Always paint specific room details.

═══════════════════════════════════════════════════════════════════════
📚 WORKED EXAMPLE (so you cannot misread the rule)
═══════════════════════════════════════════════════════════════════════

CLIENT IDEA: "preview baju depan cermin"
FRAMEWORK chosen for Video 1: "Testimonial" (UGC, character on screen)

✅ CORRECT output (idea visible as the scene, framework drives dialog):
   "Medium shot, Malay woman in her 30s wearing a sage green hijab and
   the assigned dusty rose blouse, standing in front of a full-length
   bedroom mirror, slowly turning to preview her outfit reflection,
   warm morning light from window. Spoken dialog: 'Dulu aku ingat baju
   ni biasa je, tapi bila pakai depan cermin baru rasa sebenarnya
   classy gila. Lepas pakai 2 minggu confirm korang akan suka. Cuba
   la, memang berbaloi!'"
   ↳ Idea = mirror preview scene (SHOWN visually). Framework = Testimonial
     dialog shape (doubt → turning point → recommendation). PERFECT.

❌ WRONG output (idea ignored, generic UGC scene used instead):
   "Medium shot, Malay woman in her 30s, sitting on a sofa holding the
   product up to camera. Spoken dialog: '...'"
   ↳ Where's the mirror? Where's the preview? Idea drifted. REJECTED.

❌ WRONG output (idea respected but framework type ignored):
   Same idea + framework as above, but written as: "Product folded on a
   shelf in front of a mirror, slow zoom, no person, voiceover: '...'"
   ↳ Framework was UGC (character on screen with face) but this is
     product-only. REJECTED — wrong type. PRD-style execution for a
     UGC framework slot.

─── Same idea + DIFFERENT framework on Video 2: "Product Hero" (PRD) ───

✅ CORRECT: "Cinematic close-up of the folded dusty rose blouse resting
   on a marble shelf directly in front of a tall standing mirror, the
   mirror's reflection shows the blouse from another angle, soft golden
   afternoon light, slow dolly-in. Voiceover (warm Malay female): '...'"
   ↳ Same mirror scene → product replaces the person → voiceover from
     PRD framework. Idea preserved, framework type respected.

═══════════════════════════════════════════════════════════════════════
✅ SELF-CHECK — for EACH video you write, answer these 4 questions
   BEFORE moving on. If any answer is NO, rewrite that video.
═══════════════════════════════════════════════════════════════════════

   Q1. Does the videoPromptShot1 mention the SPECIFIC scene/setting
       from the client's idea (e.g. "in front of mirror", "on bedroom
       dresser", "by morning coffee")? Generic "cozy bedroom" doesn't
       count if the idea was "in front of mirror".
       → YES / NO

   Q2. Does the videoPromptShot1 show the CENTRAL ACTION from the
       idea (preview / unbox / pour / try on / hold up / etc.)?
       → YES / NO

   Q3. Does the on-screen TYPE match the framework?
        UGC → character visible with face speaking?
        PRD → zero person, product is the subject?
        POV → hand only, no face/body?
       → YES / NO

   Q4. Does this video's staging differ from every other video in the
       batch (different camera angle OR different action beat OR
       different time-of-day)?
       → YES / NO

   If ALL 4 = YES → ship the video. If ANY = NO → rewrite until YES.
</idea_style>

` : ""}<HARD_RULES_READ_THIS_FIRST>
🚨 THE 3 LOCKS — APPLY TO EVERY UGC + LIFESTYLE VIDEO (NOT product/handPov):
1. GENDER = ${gender.toUpperCase()}   → ${gender === "male" ? '"Malay man" — never "woman", never "girl"' : '"Malay woman" — never "man", never "girl"'}
2. HIJAB  = ${hijabMode ? "YES — character wears hijab tudung labuh that fully covers ALL hair, ears, neck. ZERO hair strands visible." : "NO — character has hair visible. NEVER write the word \"hijab\", \"tudung\", or any head-covering."}
3. AGE    = ${ageRange}   → must appear in every UGC/lifestyle prompt

🚨 REQUIRED PREFIX FOR EVERY UGC + LIFESTYLE imagePrompt AND videoPromptShot1${is16s ? " AND videoPromptShot2" : ""}:
The prompt MUST start with this exact person-lock prefix, then YOU add a Malaysian-style outfit clause + action. Examples:
- PRODUCT example:  "${requiredPrefix()}, wearing [YOUR PICK: Malaysian-style outfit unique to this video — see <clothing_variety>], holding the product, [shot type + action]"
- WEARABLE example: "${requiredPrefix()}, WEARING the product on body (NOT holding), [shot type + action]"   ← if product is clothes/hijab/shoes/bag/jewelry/abaya/watch, use THIS form (no separate outfit clause — product IS the outfit)

🚨 DO NOT use these forbidden lazy phrases:
- "plain brown ___"    "neutral ___"    "casual outfit"    "modest outfit"    "simple ___"   "generic ___"
- ${hijabMode ? '"loose hair", "free hair", "hair visible", "uncovered" — character ALWAYS has hijab' : '"hijab", "tudung", "headscarf" — character has NO hijab'}
- "person" / "individual" — always write the exact gender word
- Same Malaysian outfit silhouette / colour-family across two consecutive videos

🚨 FAILURE CONDITIONS (Qwen will reject these outputs as broken):
- imagePrompt or videoPrompt missing the gender word "${gender === "male" ? "Malay man" : "Malay woman"}"
- imagePrompt or videoPrompt missing the age "${ageRange}"
- ${hijabMode ? "imagePrompt or videoPrompt missing the word \"hijab\" — and hijab MUST be described as LOOSE tudung labuh, never tight" : "imagePrompt or videoPrompt contains the word \"hijab\""}
- Outfit not Malaysian-style (e.g. Western mini dress, crop top, gym leggings without modest tunic on top)
- Two consecutive videos in the batch using the same outfit silhouette or colour family
- Any video defaulting to plain brown / beige / neutral with no specific Malaysian garment
- 🛑 WEARABLE product (pants / shirt / hijab / shoes / bag / jewelry / abaya / watch / scarf) described as "holding", "holds", "showing", "displaying" — character MUST be WEARING it. Example failure: "Malay man holding black pants and showing them" ✗. Required form: "Malay man wearing the black pants, gesturing to his outfit" ✓.
- Wearable items "floating", "on a hanger", "on a mannequin", or any depiction of the wearable NOT physically on the character's body
</HARD_RULES_READ_THIS_FIRST>

${noImageMode ? `
<no_image_mode_rules>
NO-IMAGE MODE: The video model receives ONLY the product image as a reference (no avatar image). Prompts must be self-contained, SHORT (under 1000 chars each), and avoid referencing a "reference image" for the person.

FORBIDDEN phrases in this mode (DO NOT use):
- "same person from reference image" (there is no reference image for the person)
- "holding the same product" (the product is the reference — just say "holding the product")
- Any phrase that implies a pre-existing person image

DURATION MODES:
- 8-second video → ONLY videoPromptShot1 (complete 0-8s story). videoPromptShot2 = "" (empty string).
- 16-second video → videoPromptShot1 (first 8s: 0-8s) + videoPromptShot2 (second 8s: 8-16s), merged after generation. BOTH are 8-second prompts, but the dialog continues from shot 1 to shot 2 as ONE story.

EVERY videoPromptShot1 and videoPromptShot2 must include — CONCISELY — these elements exactly once (no duplication). The exact composition depends on the video's TEMPLATE (see <frameworks> below):

1. ONE subject line — varies by template:
   • TEMPLATE A (UGC, character on screen): "${characterBlock}"
   • TEMPLATE B (PRODUCT ONLY, no person): describe the product in frame instead — e.g. "[Shot type] of the product on [surface/setting]". DO NOT include character description, gender, age, hijab, or any person reference. The person fields above (gender/age/hijab) are IGNORED for Template B videos.
   • TEMPLATE C (HAND-POV): describe hand only — "Single ${gender} hand holding the product, NO face, NO body". Hand gender matches the avatar choice.

2. ONE voice line: "${voiceBlock}"
   • TEMPLATE A → "Character says: '<full dialog>'"
   • TEMPLATE B / C → "Voiceover (warm Malay female/male): '<full dialog>'" — voice is narration, NOT from a visible character.

🚨 MANDATORY DIALOG FORMAT — Veo's TTS fails when dialog is unquoted.
   ALL spoken dialog text MUST be wrapped in single quotes ' '.
   For 8-second shots, write the whole dialog as ONE quoted string:
     Character says: 'Korang tau tak, ni game-changer betul. Beg rotan ni nampak premium gila. Tekan beg kuning sekarang!'
   FORBIDDEN format (causes audio-gen failure):
     Spoken dialog:
     0-2s: Korang tau tak...
     2-6s: ...
     6-8s: ...
   Beat timing (0-2s/2-6s/6-8s) is a WORD-COUNT GUIDE for you, NOT
   for the prompt — never write the timestamps in the final prompt.

3. ONE setting line: [single sentence describing the scene — match the product's natural environment]
   • TEMPLATE A → setting includes the character (e.g. "in a cozy kitchen")
   • TEMPLATE B → setting is product-focused (e.g. "on a marble counter", "floating against a soft backdrop")
   • TEMPLATE C → setting is the rotating luxury vehicle / authentic background (see Template C rules)

4. ONE action/dialog timeline per shot (timestamps are LOCAL to that 8-second shot, always 0-8s within the shot):
   - 0-2s hook: max 6 words
   - 2-6s middle: max 12 words
   - 6-8s ${noCta ? "outro / natural closing line (NO CTA — user did NOT pick a CTA mode; this video is meant to be extended later)" : "CTA"}: max 6 words
   (For 16s videos: shot 1's 6-8s is NOT the ${noCta ? "outro" : "CTA"} — use mid-story line; ${noCta ? "the closing line goes in shot 2's 6-8s only." : "the CTA goes in shot 2's 6-8s only."})

5. ONE anatomy + voice lock sentence — varies by template:
   • TEMPLATE A: "Anatomically perfect: 2 hands, 5 fingers, no extra limbs. Audio: ONE single voice only, no background voices, no chatter, no friends."
   • TEMPLATE B: "Audio: ONE voiceover only, no characters in frame, no background voices, no chatter."
   • TEMPLATE C: "Anatomically perfect: ONE hand visible, 5 fingers, no extra fingers, NO face/body in frame. Audio: ONE voiceover only."

6. ONE clean rule (MANDATORY anti-subtitle + anti-icon wording — Veo auto-captions TikTok content unless explicitly told not to): "RAW UNEDITED FOOTAGE AESTHETIC: this is a raw camera recording, NOT a published TikTok post. Character or product fills the frame naturally edge-to-edge like a normal phone-shot video. Zero subtitles, zero captions, zero auto-generated dialog text, zero TikTok-style animated captions, zero sticker text, zero pop-up text bubbles, zero closed captions, zero icons, zero emojis, zero graphics, zero overlays, zero watermarks, zero UI elements, zero handles, zero hashtags. The phrase 'beg kuning' is SPOKEN DIALOG ONLY — NEVER a yellow bag icon, shopping bag graphic, button, or visual element. Treat output like a camera recording a moment, NOT a TikTok post."
   Add the following frame-content sentence based on template:
   • TEMPLATE A → "Frame shows the person, the product, and the real-world setting."
   • TEMPLATE B → "Frame shows ONLY the product and the setting — NO person, NO face, NO hands, NO body anywhere."
   • TEMPLATE C → "Frame shows ONLY one hand holding the product against the chosen background — NO face, NO body, NO arm above wrist."

7. ONE product lock: "Product must be pixel-identical to the product reference — no color/shape/label changes."

🚨 CRITICAL: When the framework's TEMPLATE is B or C, IGNORE the locked-avatar / character description above. The fields gender/age/hijab apply ONLY to Template A. Do NOT include any person/character description in Template B prompts. For Template C, the only "person" element is a single hand (gender-matched).

Keep EACH shot prompt under 1000 characters. Do NOT repeat the voice description — it goes in step 2 ONLY. Dialog MUST be wrapped in single quotes (see MANDATORY DIALOG FORMAT in step 2). Use natural Malay sentences that fit the timing window (too many words = audio generation fails).
</no_image_mode_rules>
` : ""}

<attachment_classifier>
🧠 BEFORE choosing TEMPLATE / scene, INSPECT the product reference image
for THIS video and classify the attachment:

  • PRODUCT  → consumable, holdable item the user uses ON themselves
               (skincare, supplement, food, drink, electronics, toy).
               Avatar HOLDS or USES it.

  • WEARABLE → clothing, hijab/tudung, abaya, jewelry, accessories,
               shoes, bag, watch, glasses — anything the avatar
               puts ON their body.
               Avatar WEARS / PREVIEWS / TRIES IT ON. NEVER holds it
               like a product. If you catch yourself writing "holds
               the hijab/dress/bag" — STOP and rewrite as
               "wearing the hijab" / "carrying the bag on shoulder"
               / "twirling in the dress".

  WEARABLE override rules:
  - FORCE TEMPLATE A (avatar visible, wearing the item)
  - SKIP TEMPLATE B (product-only is wrong — no shot of clothes
    floating in mid-air without a body)
  - SKIP TEMPLATE C (hand-POV of a hijab makes zero sense)
  - Pick a scene from <scene_pool> tagged [wearable] or [both]
  - imagePrompt MUST describe the avatar wearing the item
    (e.g. "Malay woman in cream baju kurung set, full mirror selfie")
    NOT holding it (no "holds the dress on a hanger")
</attachment_classifier>

<scene_pool>
For EACH video, pick ONE scene from this catalog that matches the
attachment type. Each batch of videos should use DIFFERENT scenes —
no two videos in this batch should share the same scene_id.

${(() => {
  const pickedScenes = pickScenes(Math.max(fwPoolFinal.length + 2, 8), "both");
  return pickedScenes.map((s) => sceneSummary(s)).join("\n");
})()}

Per video, after you pick the scene_id, USE the scene's setting,
camera framing, lighting and action beats. The framework's CTA and
hook still apply — the scene gives you the WORLD the video lives in
(in-car / kitchen / cafe / mirror selfie / unboxing / mukbang / ...).
</scene_pool>

<frameworks>
For EACH video below, you MUST use the matching TEMPLATE specified at the
end of the line. NEVER cross-wire — if it says TEMPLATE B, the imagePrompt
MUST be a product-only shot (no person at all) and the videoPrompt MUST be
voiceover-only with the product on screen.

⚠️ TEMPLATE selection is OVERRIDDEN by <attachment_classifier> above. If
the video's attachment is WEARABLE, switch to TEMPLATE A regardless of
what the framework says, and reflect that in your imagePrompt + scene
choice.

${fwPoolFinal.map((fw, i) => {
  // Three template types based on framework flags:
  //   • handPov → Template C: hand visible holding product, NO face/body, luxury vehicle bg
  //   • type "product" → Template B: zero person/hand, pure product showcase
  //   • else (ugc/lifestyle) → Template A: full character on screen
  let template: string;
  if (fw.handPov) {
    template = "→ TEMPLATE C (HAND-POV: ONE female hand visible holding the product — NO face, NO body, NO arm above wrist — pure hand+product hero against rotating LUXURY VEHICLE INTERIOR background. Voiceover only, no on-screen speaker.) ⚠️ Skip if WEARABLE — use TEMPLATE A instead.";
  } else if (fw.type === "product") {
    template = "→ TEMPLATE B (PRODUCT ONLY: NO person, NO face, NO hands, NO body anywhere — pure product shot + voiceover) ⚠️ Skip if WEARABLE — use TEMPLATE A instead.";
  } else {
    template = "→ TEMPLATE A (UGC: character on screen, speaks to camera. PRODUCT → holds it. WEARABLE → wears it.)";
  }
  const strictTag = fw.strictUsp
    ? "  🔒 STRICT USP MODE — read <strict_usp_rules> below. ZERO drift allowed."
    : "";
  return `${i + 1}. ${fw.name} [${fw.type.toUpperCase()}] — ${fw.focus}\n   ${template}${strictTag ? "\n" + strictTag : ""}`;
}).join("\n")}

🚨 LOCKED-AVATAR BLOCK ABOVE APPLIES ONLY TO TEMPLATE A VIDEOS. For
TEMPLATE B videos the locked-avatar is IGNORED — there is NO person on
screen, period. The imagePrompt for those videos describes ONLY the
product (e.g. "the yoga pants laid flat on textured concrete with soft
sidelight, 100mm macro, shallow DOF") — no woman, no man, no hands.

🚨 TEMPLATE C HAND-POV RULES (PROD Goyang2 / hand-only frameworks):
- ONE hand only visible in frame, MATCHING the avatar gender chosen by
  the user (gender = "${gender}"):
    • female → Malay female hand, modest, light skin, simple manicure,
      delicate proportions, optional thin bracelet, no flashy jewelry
    • male → Malay male hand, slightly broader, no manicure, optional
      simple wristwatch or leather strap, masculine proportions
  Hand grips the product firmly with label facing camera.
- The hand gently shakes/sways the product in a slow relaxed rhythm
  (5-10° tilts, small horizontal motion). This is the hero animation.
- ABSOLUTELY NO face visible, NO body visible, NO arm above the wrist,
  NO shoulder, NO head. Camera frames hand+product only.
- BACKGROUND VARIETY (CRITICAL — pick ONE setting per video, rotate
  across the batch so each video has a DIFFERENT background):
  Luxury vehicle interior: Lamborghini Urus / Mercedes-Benz S-Class /
    Ferrari 488 / Porsche 911 / Bentley Continental / BMW M5
  Everyday Malaysian car: Honda Civic / Perodua Myvi / Toyota Vios
  Aesthetic indoor: cozy bedroom with curtain+plant / marble bathroom
    counter / coffee shop wooden table / vanity table with mirror+pampas
  Retail discovery: Watsons skincare aisle / Aeon supermarket /
    Korean cosmetics store with pastel shelves
  Studio clean: beige backdrop diffused / white marble flat surface
  Outdoor lifestyle: beach cabana / rooftop infinity pool
  Mix categories across batch (1 luxury car, 1 retail, 1 cozy, 1 outdoor,
  etc.) — variety is the scroll-stop hook.
- Audio: voiceover only (warm Malay female, casual bestie tone). Voice is
  NOT from a visible character — it's narration over the hand+product.
- imagePrompt for Template C: "Single female hand holding [product] —
  hand-only POV close-up, NO face, NO body. Background: [chosen authentic
  setting from the rotation above]." Match product reference pixel-identical.
- The locked-avatar block is IGNORED for Template C (no character is shown).
- ANATOMY constraint: ONE hand, 5 fingers, no extra limbs, no face/body
  in frame. Negatives must include: face visible, body visible, arm
  visible, shoulder visible, full character, head in frame.
</frameworks>

${fwPoolFinal.some((fw) => fw.strictUsp) ? `
<strict_usp_rules>
🔒 STRICT USP MODE — APPLIES ONLY TO FRAMEWORKS MARKED 🔒 ABOVE.
For any video using "UGC USP (Strict)" or "Product USP (Strict)":

ABSOLUTE RULES:
1. EVERY claim, benefit, ingredient, problem, result, timeframe, or number
   in the dialog/voiceover/caption MUST appear in <product_data> below.
   If <product_data> doesn't mention X, you CANNOT mention X.

2. DO NOT invent:
   - Specific timeframes ("30 hari", "2 minggu", "5 tahun")
   - Money amounts ("RM200 saved", "save 50%")
   - Personal stories unrelated to the product's actual use case
   - Ingredients or formulations not stated
   - Percentages, ratings, or stats not given
   - Generic "viral" claims ("best skincare 2024") not in source

3. PICK ONE SPECIFIC USP from <product_data> for each strict video.
   Bind the entire video (hook, dialog, caption, cover) to that ONE USP.
   Do NOT mix multiple USPs in one strict video.

4. If <product_data> is too vague to make a strong video, write the
   simplest accurate dialog (just product name + the actual stated benefit${noCta ? "" : "\n   + CTA"}). DO NOT compensate by adding fluff or invented context.

5. CAPTION must directly mention the actual USP from product_data.
   Hashtags can be generic, but the caption sentence(s) must be factual.

6. COVER TITLE = product name. COVER SUBTITLE = the actual USP claim
   from product_data (in caps, max 5-6 words).

REMEMBER: Strict mode prioritizes ACCURACY over CREATIVITY. If forced to
choose between "boring but true" and "viral but invented" — pick TRUE.
</strict_usp_rules>
` : ""}

<dialog_style_rules>
ALL dialog MUST sound like a real Malaysian friend talking — NEVER like a script:
- Use: korang, aku, tau, kan, ni, tu, macam, serious, confirm, memang, gila
- Add fillers: "eh korang", "serious ni", "tau tak", "jap jap", "aku nak share ni"
- Speak like texting: incomplete sentences OK, reaction words OK
- Mix English naturally: "best gila", "confirm berbaloi", "serious game changer"
- NEVER use formal: saya, anda, tuan, puan, selamat sejahtera
- Emotion must be REAL — excited = genuinely excited, sad = genuinely concerned
- Each video has DIFFERENT speaking style (excited/whispering/storytelling/urgent/casual)
</dialog_style_rules>

<viral_hook_bank>
THE FIRST 2 SECONDS DECIDE EVERYTHING. Use PROVEN viral hook patterns (adapted to informal Bahasa Malaysia).
Never use plain opening like "Hai korang, hari ni aku nak share..." — that gets scrolled past.

PICK A DIFFERENT HOOK PATTERN FOR EACH VIDEO (rotate to create variety):

1. KNOWLEDGE GAP (curiosity):
   - "Korang tau tak, benda ni aku baru je discover..."
   - "Serious, takde orang cerita pasal ni..."
   - "Jap, aku nak bagitau satu benda..."
   - "Rahsia ni aku tak pernah share dekat siapa..."

2. CONTRARIAN / MYTH BUST:
   - "Stop buat [habit]. Ni yang betul..."
   - "Semua orang salah pasal ___. Yang sebenar..."
   - "Aku tak suka cakap, tapi ___ ni bohong..."
   - "Korang rasa ___ works? Aku tunjuk sebenar..."

3. PERSONAL MISTAKE / REGRET:
   - "Kalau aku tau benda ni awal-awal, aku tak akan buang duit..."
   - "Aku dah buat silap 3 bulan. Jangan ikut aku..."
   - "Serious, aku menyesal tak buat ni sooner..."
   - "Aku dulu pun macam korang — sampai aku jumpa ni..."

4. SHOCK RESULT / NUMBERS:
   - "30 hari pakai ni, hasil dia serious gila..."
   - "Aku test 5 brand, last-last yang ni menang..."
   - "Selepas satu minggu je — aku sendiri tak percaya..."
   - "RM___ sebulan aku save sebab pakai ni..."

5. PROBLEM CALLOUT (pain point):
   - "Penat kan [pain]? Aku pun... sampai aku cuba ni..."
   - "Susah nak tidur sebab ___? Ni je aku buat..."
   - "Muka berminyak lepas lunch? Korang tak keseorangan..."

6. QUESTION / CHALLENGE:
   - "Siapa antara korang masih ___?"
   - "Kenapa takde orang cerita pasal ni?"
   - "Korang pernah rasa ___? Jap aku tunjuk..."

7. BOLD CLAIM / STATEMENT:
   - "Ini product yang terbaik aku pernah guna untuk ___"
   - "Serious — selepas ni korang takkan pakai yang lain"
   - "Aku berani cakap, ni game changer"

8. STORY OPENER:
   - "Okay jap, aku nak cerita something..."
   - "Cerita real — minggu lepas aku ___"
   - "Eh, event hari tu aku ternampak ___"

9. WARNING / URGENCY:
   - "Jangan beli ___ before tengok ni..."
   - "Stop. Tengok ni dulu sebelum korang rugi..."
   - "Eh eh jangan scroll, benda ni penting..."

10. AUTHORITY / EXPERIENCE:
    - "Aku dah test 10 ___ — ni je yang worth beli"
    - "Selepas 2 tahun cuba bermacam cara, ni paling senang"
    - "Penggunaan dah 6 bulan — ni honest review aku"

11. TRUTH / CONFESSION:
    - "Yang sebenar tentang ___, takde orang cakap..."
    - "Okay serious, aku nak honest pasal ___..."
    - "Kalau korang nak tau yang betul tentang ___..."

12. REGRET / WISH I KNEW:
    - "Aku harap ada orang bagitau aku pasal ni awal-awal"
    - "Kalau balik masa, benda pertama aku buat — ___"
    - "Aku menyesal tak jumpa ni sooner..."

13. BEFORE/AFTER / TRANSFORMATION:
    - "Aku tengok cermin, tak percaya ni muka aku..."
    - "Dari yang paling teruk, sekarang ni..."
    - "Korang ingat before after ni fake? Aku buktikan..."

14. LAZY / EASY WAY:
    - "Cara paling malas untuk ___"
    - "Aku tak ada masa, jadi aku buat macam ni je..."
    - "Tak payah effort lebih, ni je korang perlu..."

15. TESTED SO YOU DON'T HAVE TO:
    - "Aku spend RM___ test 5 brand — ni pemenang"
    - "Dah cuba semua cara, last-last yang ni je work"
    - "Buang masa korang kalau try yang lain — ni je yang best"

16. DON'T DO THIS:
    - "Jangan buat silap aku — jangan ___"
    - "Aku nak warn korang, stop buat ___ sekarang"
    - "Kalau korang still ___, berhenti. Ni yang betul..."

17. UNPOPULAR OPINION:
    - "Mungkin aku sorang rasa macam ni, tapi ___"
    - "Opinion yang ramai takkan suka — ___"
    - "Aku tau ramai tak setuju, tapi ___"

18. SIMPLE FRAMEWORK:
    - "3 step je untuk ___ yang aku buat setiap hari"
    - "Formula aku untuk ___ — senang sangat"
    - "Tak payah pening, ikut 3 step ni..."

19. BEGINNER FRIENDLY:
    - "Kalau korang baru nak start ___, ni je korang perlu"
    - "Tak perlu pro, aku pun baru je start — dah boleh"
    - "First-timer? Ni yang aku harap orang cakap dekat aku dulu..."

20. CURIOSITY / WATCH FIRST:
    - "Sebelum korang beli ___, tengok ni dulu"
    - "Jangan skip ni — korang akan terima kasih nanti"
    - "Ada satu benda korang kena tau tentang ___"

DIALOG QUALITY RULES:
- First 2 seconds = the hook (one of the patterns above). It MUST create curiosity, shock, or resonate with pain.
- Middle 3-5s = payoff — show/demonstrate the value of the product
- Last 1-2s = call-to-action or emotional close (if CTA mode is on)
- Every dialog must have SPECIFIC WORDS (numbers, named pain points, concrete results) — NOT vague claims like "best", "bagus", "recommended"
- Bahasa Melayu ONLY — NO mixing except natural slang (best gila, game changer, serious)
- ROTATE hooks across the batch — if video 1 uses "Korang tau tak", video 2 MUST use a different pattern.
</viral_hook_bank>

<camera_and_visual_rules>
EVERY video MUST have dynamic visuals — NO static medium-pose-only:

SHOT TYPES TO ROTATE (use ALL of these across ${quantity} videos):
- Medium shot, waist up (standard UGC)
- Close-up, head and shoulders (emotional, intimate)
- Selfie-style handheld with slight shake (authentic UGC feel)
- Low-angle looking up (powerful, confident)
- Over-the-shoulder (intimate, like sharing a secret)
- Product extreme close-up with hands (detail shot)
- Arc/dolly shot circling around subject (cinematic)
- Walking towards camera (dynamic energy)

CAMERA MOVEMENTS — at least 3 different ones across the batch:
- Static (calm, emotional)
- Slight zoom in during hook (attention)
- Handheld shake (authentic)
- Slow pan across product (detail)
- Pull back reveal (surprise)

BACKGROUNDS — choose SMART settings that match the product:
${productData.productName ? `(Think: where would someone ACTUALLY use ${productData.productName}?)` : ""}
- Cozy bedroom (beauty, intimate products)
- Bright kitchen (food, health, supplements)
- Bathroom vanity (skincare, beauty tools)
- Living room sofa (casual, lifestyle)
- Car interior (on-the-go products)
- Office desk (productivity, work supplements)
- Garden/outdoor (natural, organic products)
- Cafe/restaurant (food, social products)
- Gym/workout area (fitness, supplements)
- Dressing table (makeup, jewelry)
- Night market stall (viral products)
- Studio with gradient background (premium products)
EVERY video MUST use a DIFFERENT background. Match to product logically.
</camera_and_visual_rules>

<locked_avatar>
🔒🔒🔒 NON-NEGOTIABLE CHARACTER LOCK — APPLIES TO EVERY UGC + LIFESTYLE VIDEO 🔒🔒🔒

The user has EXPLICITLY chosen this avatar from the dropdowns. The character generated MUST match EXACTLY. There is ZERO tolerance for drift. If the product feels like it's for a different demographic, the chosen avatar STILL promotes/reviews it — you do NOT swap gender or age to "fit" the product.

THE THREE LOCKED ATTRIBUTES (must appear word-for-word in every UGC/lifestyle imagePrompt AND videoPrompt):

1. GENDER LOCK → ${gender.toUpperCase()}
   ${gender === "male"
     ? "Every prompt MUST include the phrase \"Malay man\" (NOT \"woman\", NOT \"person\", NOT \"individual\"). Masculine pronouns. Male voice. Male hands in hand-POV shots."
     : "Every prompt MUST include the phrase \"Malay woman\" (NOT \"man\", NOT \"person\", NOT \"individual\"). Feminine pronouns. Female voice. Female hands in hand-POV shots."}

2. STYLE LOCK → ${hijabMode ? "HIJAB (TUDUNG LABUH)" : "NO HIJAB (HAIR VISIBLE)"}
   ${hijabMode
     ? "Every UGC/lifestyle prompt MUST include the phrase \"wearing a hijab / tudung labuh that fully covers all hair, ears and neck\". The hijab is non-negotiable in 100% of frames. ZERO hair strands visible. NEVER bangs, NEVER fringe, NEVER side-hair peeking out. The tudung stays put through every head turn, smile, and reaction. If you write \"hair flowing\" or \"loose hair\" or anything implying visible hair — that is a CRITICAL FAILURE."
     : "Every UGC/lifestyle prompt describes the character with hair visible (modern modest casual). DO NOT write \"hijab\", \"tudung\", \"headscarf\", or any head-covering. The character has natural hair visible — but MODESTY STILL APPLIES (no cleavage, no midriff, no thigh exposure)."}

3. AGE LOCK → ${ageRange}
   ${avatarAge === "20s"
     ? "Every prompt MUST describe the character as \"in her/his 20s, young adult\". Youthful, fresh, dewy skin. NO crow's feet, NO mature features, NO middle-aged framing."
     : avatarAge === "30s"
       ? "Every prompt MUST describe the character as \"in her/his 30s\". Mature adult — radiant skin with subtle character, confident energy. NOT a teenager, NOT a makcik."
       : avatarAge === "40s"
         ? "Every prompt MUST describe the character as a \"makcik in her/his 40s\". Mature warm presence, soft laugh lines OK, NOT a young adult. Wisdom-of-experience tone in voice + posture."
         : avatarAge === "55+"
           ? "Every prompt MUST describe the character as a \"nenek / older Malay woman/man in her/his 50s-60s\". Visible age — soft silver hair (under hijab if hijab), warm wrinkles, calm wise demeanor. NOT a young adult."
           : "Every prompt MUST describe the character as \"in her/his 30s\"."}

VALIDATION RULE: Before you write each video's imagePrompt and videoPrompt, re-read the three locks above. If your sentence doesn't include the exact gender word, the exact hijab/no-hijab phrasing, AND the exact age band — REWRITE IT. The user paid for ${gender}/${hijabMode ? "hijab" : "no-hijab"}/${ageRange} and that is what must ship.

- BEAUTY LOCK (applies to UGC + LIFESTYLE frameworks — product frameworks have NO character and IGNORE this lock): ${gender === "male" ? "Handsome attractive Malay man — sharp jawline, clear skin, confident friendly presence, well-groomed. State \"handsome attractive Malay man with sharp features and clear skin\" in every UGC + lifestyle framework imagePrompt and videoPrompt." : "Beautiful attractive Malay woman — clear glowing skin, warm natural smile, confident gentle presence, well-groomed. State \"beautiful attractive Malay woman with clear glowing skin\" in every UGC + lifestyle framework imagePrompt and videoPrompt."}
- SAME person across the batch (same face structure, same skin tone, same age). Only OUTFIT + SETTING change between videos (see <clothing_variety> below for strict outfit-rotation rules).
</locked_avatar>

<clothing_variety>
🎨 OUTFIT — MODERN MALAYSIAN FASHION, YOU DECIDE PER VIDEO

You are dressing a real Malaysian for TikTok in 2026 — think how Malaysians
ACTUALLY dress today, not stereotypes. Modern Malaysian street style is
broad: jeans + oversized tee, modest casual sets, modern abaya, loose
button-ups, hoodies, cardigans, modern modest activewear, smart-casual
office wear, lounge-at-home fits, AND occasionally traditional pieces
(kebaya / baju kurung / kemeja Melayu) when the scene calls for it. Pick
what a real person in that scene would wear — not what a costume designer
would put on them.

🚫 FORBIDDEN — never use these as the outfit description:
- "plain brown ___"  /  "plain beige ___"  / generic "neutral" / "simple"
- "casual outfit" without specifying colour + garment
- Forcing traditional wear (kebaya / baju Melayu / baju kurung) for every
  video — that's stereotyping; modern Malaysians dress modern most days
- Repeating the same garment silhouette or colour family on consecutive videos
${hijabMode ? "- Tight hijab, fitted hijab, sport hijab that hugs the head — hijab is ALWAYS loose tudung labuh\n- Skinny jeans / tight leggings / form-fitting pants — modest fit only" : "- Tank tops, sleeveless, crop tops, anything showing midriff or cleavage"}
${gender === "female" ? "- Mini skirts, short shorts, anything above the knee" : "- Shirtless, tank tops, anything showing chest"}

✅ REQUIRED — every video's imagePrompt AND videoPrompt MUST specify:
   COLOUR + GARMENT TYPE + optional pattern
   Modern examples that feel like real Malaysians:
   ${hijabMode
     ? gender === "female"
       ? `- "olive green oversized button-up + loose dark jeans + LOOSE cream hijab"
   - "soft beige modest knit cardigan over white tee + flowy maxi skirt + LOOSE soft pink hijab"
   - "navy blue modest activewear set (loose tunic over wide-leg track pants) + LOOSE soft grey hijab"
   - "dusty rose long-sleeve modest midi dress + LOOSE mauve hijab"
   - "terracotta modest blouse + flowy palazzo pants + LOOSE warm beige hijab"
   - Traditional pieces (baju kurung, kebaya) work too — but only when the scene/idea calls for it, not by default`
       : `- "charcoal grey oversized hoodie + relaxed dark jeans"
   - "olive green button-up shirt with rolled sleeves + sand chinos"
   - "cream knit sweater + relaxed charcoal trousers"
   - "navy blue casual blazer over white tee + slim chinos"
   - "burgundy henley + dark indigo jeans"
   - Traditional pieces (kemeja Melayu, baju Melayu) work too — but only when the scene/idea calls for it`
     : gender === "female"
       ? `- "oversized cream knit sweater + indigo straight-leg jeans"
   - "loose sage green linen button-up + cream wide-leg pants"
   - "dusty rose long-sleeve midi dress with subtle floral print"
   - "modest mustard yellow blouse + flowy maxi skirt"
   - "navy oversized blazer + white tee + relaxed beige trousers"`
       : `- "charcoal grey hoodie + relaxed dark jeans"
   - "olive green button-up + sand chinos"
   - "cream knit sweater + charcoal trousers"
   - "burgundy henley + indigo jeans"
   - "navy blazer over white tee + slim chinos"`}

COLOUR INSPIRATION (pick freely, never default to plain brown/beige):
- Earthy: terracotta, dusty rose, olive, navy, sage green, warm taupe, cream, rust
- Pastels: soft pink, lilac, mint sage, butter yellow, baby blue, peach, blush
- Jewel tones: emerald green, sapphire blue, ruby red, plum, mustard, burgundy, deep teal
- Neutrals (with character): charcoal grey, deep navy, forest green, sand brown, indigo
- Patterns (use sparingly): small floral, gingham, polka dot, abstract watercolour, subtle batik

VARIATION RULE: For a batch of ${quantity} videos, outfits MUST span at LEAST ${Math.min(Math.max(quantity, 3), 8)} distinct garment silhouettes and ${Math.min(Math.max(quantity, 3), 8)} distinct colour families. NO TWO CONSECUTIVE videos may share garment silhouette OR colour family.

Write the outfit phrase BEFORE finalising each video's prompts so you have it in hand when composing imagePrompt + videoPrompt.
</clothing_variety>

<image_prompt_rules>
EVERY video MUST have an imagePrompt (max 600 chars).

FOR UGC FRAMEWORKS (character ONLY — NO product in image):
- Use the LOCKED AVATAR above — same person every time
- ${hijabMode ? "Character MUST wear hijab tudung labuh in EVERY image — NO exceptions" : "Character has visible hair, casual modern look. Short-sleeve T-shirts OK for female (loose fit). MUST be modest: NO tight tops showing breast shape, NO cleavage, NO crop tops / midriff / navel, NO short shorts / mini skirts / thigh exposure."}
- CHARACTER ONLY — do NOT include any product, phone, or object in the image. HANDS MUST BE EMPTY — not holding anything. No phone, no selfie, no product, no bag, no prop. Hands gently placed in front or relaxed at sides.
- MUST be STANDING or MEDIUM SHOT (waist up minimum) — show body, arms, hands visible. NEVER close-up face only. Facing slightly to the side while looking at camera.
- FACE: Invent a UNIQUE specific attractive face — describe smooth glowing skin, natural makeup (blush, glossy lips, defined brows), specific features (dimples, face shape, skin tone). Make this person look like a REAL beautiful individual. NEVER use generic "oval face, warm brown eyes".
- BACKGROUND: Softly lit elegant indoor setting — warm tones, subtle drapery, soft gradient, or blurred aesthetic backdrop. No mirrors, no reflections, no glass. Clean and premium feel.
- Outfit: PICK A SPECIFIC COLOUR + GARMENT from <clothing_variety> — modern Malaysian fashion, DIFFERENT every video, NEVER "plain brown" or "neutral beige" defaults. Think how Malaysians ACTUALLY dress today (modern smart-casual / lounge / street style) — traditional pieces only when the scene/idea calls for it. ${gender === "male" ? "Real examples: \"charcoal grey hoodie + relaxed dark jeans\", \"olive green button-up + sand chinos\", \"cream knit sweater + charcoal trousers\". Well-fitted modest cut (no tank tops, no shirtless). State the exact colour every time." : hijabMode ? "Real examples: \"olive green oversized button-up + loose dark jeans + LOOSE cream hijab\", \"soft beige modest knit cardigan over white tee + flowy maxi skirt + LOOSE soft pink hijab\", \"navy modest activewear set + LOOSE soft grey hijab\". Hijab is ALWAYS loose tudung labuh, different hijab colour each video coordinating with outfit." : "Real examples: \"oversized cream knit sweater + indigo straight-leg jeans\", \"loose sage green linen button-up + cream wide-leg pants\", \"dusty rose long-sleeve midi dress\". Hair visible. Short sleeves OK; NEVER cleavage, NEVER tight tops showing breast shape, NEVER shorts/skirts above knee, NEVER midriff."}
- DIFFERENT pose, emotion + outfit per image
- Lighting: soft, diffused, warm, natural glow highlighting face and outfit. Cinematic.
- Style: photorealistic, luxury portrait, high-end editorial, ultra-realistic skin texture, sharp focus, depth of field with soft bokeh, 85mm lens, f/1.8
- The product will be added separately in a later step — do NOT mention the product in imagePrompt

FOR PRODUCT FRAMEWORKS (styled product shot — NO person):
- Product centered on elegant surface/setting
- EVERY product shot MUST be DIFFERENT style: floating with smoke, on marble slab, moss garden, water droplets, volcanic rock, wooden pedestal, fabric drape, ingredient explosion, minimalist gradient, nature leaves
- Premium product photography — dramatic lighting, shallow DOF
- Style: commercial photography, 100mm macro lens, studio lighting
- NO person in frame — product only
</image_prompt_rules>

<storyboard_prompt_rules>
GeminiOmni mode ONLY (skip for Veo / Sora 2). EVERY video MUST also have
a storyboardPrompt field — a single FROZEN MOMENT describing the most
visually arresting frame of the 10-second scene. GPT Image 2 will
generate this frame, then GeminiOmni will animate from it.

STORYBOARD COMPOSITION RULES:
- Capture the SINGLE most arresting frozen moment (a pose, a gaze, a
  product-in-hand beat) — NOT the whole scene's narrative arc
- ${hijabMode ? "Character MUST wear LOOSE tudung labuh, fully covering hair / ears / neck" : "Character has visible hair, modest modern Malaysian outfit"}
- FOR UGC frameworks: BOTH character AND product visible TOGETHER in
  the frame (different from imagePrompt which says character-only)
- FOR PRODUCT frameworks: hero product shot with environment + lighting,
  no person
- FOR LIFESTYLE frameworks: scene + product naturally placed; character
  optional / incidental
- NO motion verbs ("turning", "walking", "reaching") — describe the
  pose / state as if photographed at 1/250th sec
- NO dialog quotes, NO timing markers, NO audio cues
- Setting + lighting + camera angle MUST be explicit
- 300-500 chars target (GPT Image 2 sweet spot — longer dilutes
  composition fidelity)
- ALWAYS end with this exact style suffix:
  ", photoreal cinematic 85mm lens, soft natural lighting, vertical 9:16 composition."

EXAMPLE (UGC framework with product):
"Malay woman in her 30s wearing loose dusty-rose hijab tudung labuh and
cream knit cardigan, seated at a sunlit wooden table in a cozy kitchen,
holding a Sambal X jar at chest height with both hands, gentle smile
directed slightly off-camera, soft afternoon golden light streaming
through a window behind her, warm muted background, photoreal cinematic
85mm lens, soft natural lighting, vertical 9:16 composition."

EXAMPLE (Product framework, no person):
"A Sambal X glass jar centered on a polished marble slab, gentle steam
rising from a small ceramic dipping bowl beside it, scattered fresh
chili and lime leaves in the foreground, soft side-light from camera
left casting a long subtle shadow, shallow depth of field, warm muted
backdrop, photoreal cinematic 85mm lens, soft natural lighting, vertical
9:16 composition."
</storyboard_prompt_rules>

<locked_elements>
These are LOCKED across ALL videos — NEVER change:
1. AVATAR: Same person from reference image. Same face, same gender, same age.
2. VOICE: Same ${gender === "male" ? "male" : "female"} Malay voice throughout ALL videos. NEVER switch voice.
3. PRODUCT: Same ${productData.productName || "product"}. Always the same item from reference.

These CHANGE per video (dynamic):
- Hook angle / dialog content / emotion / tone
- Shot type / camera movement / camera angle
- Setting / background / lighting
- Outfit (different each video)
- CTA variation (if shop CTA mode)
</locked_elements>

<video_prompt_rules>
🚨 FRAMEWORK-TYPE → TEMPLATE (NON-NEGOTIABLE — read this first for EVERY framework):
- frameworkType === "ugc"        → Template A. Character on screen speaking to camera. Holds the product. Same locked avatar as the LOCKED AVATAR block above.
- frameworkType === "lifestyle"  → Template A. Character on screen in an aspirational scene with the product. Same locked avatar applies.
- frameworkType === "product"    → Template B. PRODUCT-ONLY shot. NO person, NO face, NO hands, NO body. Pure product visual + voiceover. The locked-avatar block is IGNORED for these — there is no character on screen.

The frameworkType for each plan item is provided in your input — pick the correct template for each video. NEVER write a Template-A prompt for a "product" framework. NEVER write a Template-B prompt for a "ugc" or "lifestyle" framework.

${is16s ? `
16-SECOND VIDEO = ONE continuous story, split into 2 shots that will be merged.
Both shots MUST share: same setting, same product, same framework, same lighting.
ONLY difference: camera angle + dialog continuation.

VOICE LOCK (CRITICAL — DO NOT CHANGE BETWEEN SHOTS):
- Shot 1 and Shot 2 MUST use the EXACT SAME voice: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
- NEVER switch gender between shots. If Shot 1 = female voice, Shot 2 = female voice.
- Copy the EXACT Voice line from Shot 1 into Shot 2.

FOR UGC FRAMEWORKS (16s):
videoPromptShot1 (max 700 chars — Veo 3.1 Fast spec: total prompt ≤ 2000 chars including locks; custom idea details still take priority — be terse but never drop user's idea content) — FIRST HALF (0-8s):
[Shot type], same person from reference image, same appearance, with the same product (HOLDING it if PRODUCT type per <attachment_classifier>, OR WEARING it if WEARABLE type — clothes/hijab/jewelry/shoes/bag). [One action].

🚨 Spoken dialog — TOTAL MUST BE 20-24 Malay words for this 8-second shot (matches the DIALOG LENGTH LOCK appended by the system). Below 20 = character mouth freezes at end. Above 26 = rushed audio.
Beat budget (target the word counts EXACTLY):
0–2s: "[Malay hook — 4-6 words]"
2–5s: "[Malay core/setup — 10-14 words]"
5–6s: "[Malay reaction — 0-2 words, can be a short phrase like 'serius!' or 'gila']"
6–8s: "[Malay outro / lead-in to Shot 2 — 4-6 words, ends mid-thought to create suspense for Shot 2]"

Tone: [match framework emotion]
Voice: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
Style: Soft natural lighting, cinematic film look, audio dialogue only, clean vertical frame.
The character speaks directly to camera with clear voice. NO background music. NO subtitles.

videoPromptShot2 (max 700 chars — Veo 3.1 Fast spec: total prompt ≤ 2000 chars including locks; custom idea details still take priority) — SECOND HALF (8-16s):
🚨 SHOT 2 MUST BE A VERBATIM COPY OF SHOT 1 — only the spoken dialog block changes. Veo has ZERO memory between segment 1 and segment 2 — it sees ONLY this single prompt when it generates seg-2. If you write "same person as Shot 1" or "continues speaking" Veo has no clue who/what that means. Therefore:

  • Copy the FULL Shot 1 prompt VERBATIM (shot type, character description, outfit description, product description, setting, lighting, camera details, all locks).
  • Then REPLACE ONLY the "Spoken dialog" block with the new dialog below.
  • Everything else (scene, framing, character, outfit, product pose) stays IDENTICAL word-for-word.

🚨 Spoken dialog (this is the ONLY block that differs from Shot 1) — TOTAL MUST BE 20-24 Malay words for this 8-second shot. Same beat-budget structure as Shot 1.
Beat budget (target the word counts EXACTLY):
0–2s: "[Malay payoff/proof — 4-6 words, picks up from where Shot 1 ended mid-thought]"
2–5s: "[Malay benefit/value — 10-14 words]"
5–6s: "[Malay reaction — 0-2 words]"
${noCta ? '6–8s: "[Malay closing — 4-6 words]"' : `6–8s: "${shopMode ? `${SHOP_CTA_VARIATIONS[0]}" (or similar 4-6 word beg-kuning CTA — MUST mention beg kuning)` : customCtaResolved ? `${customCtaResolved}"` : '[Malay CTA — 4-6 words]"'}`}

MUST USE EXACT SAME VOICE AS SHOT 1: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
Same tone, style, framing, character, outfit, product, scene as Shot 1 — because Shot 2 IS Shot 1 with new dialog.
${noCta ? "NOTE: User did NOT select a CTA mode for this batch — 6-8s should be a natural outro/closing line (NOT a CTA), so the video can be extended later with a fresh segment." : "CRITICAL: 6-8s CTA MUST be present in Shot 2."}

FOR PRODUCT FRAMEWORKS (16s):
videoPromptShot1: [Shot type] of product on [surface]. [Smooth motion].
Spoken voiceover: 0–2s hook, 2–8s feature/benefit. NO CTA in Shot 1.
Voice: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone.

videoPromptShot2: 🚨 VERBATIM COPY of videoPromptShot1 — only the voiceover changes. Veo has no memory between segments, so saying "Same product" or "Different angle" alone gives it nothing. Repeat the full product description, surface, lighting, motion language identically.
Spoken voiceover (THE ONLY DIFFERENCE FROM SHOT 1): 0–4s payoff, 4–6s benefit, ${noCta ? "6–8s closing." : "6–8s CTA (beg kuning)."}
MUST USE EXACT SAME VOICE AS SHOT 1: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone.
Product only, voiceover only, NO person, NO music.
` : `
8-SECOND VIDEO = ONE complete shot.

FOR UGC FRAMEWORKS (8s — character on screen):
videoPromptShot1 (max 700 chars — Veo 3.1 Fast spec: total prompt ≤ 2000 chars including locks; custom idea details still take priority — be terse but never drop user's idea content):
- Start: "[Shot type], same person from reference image, same appearance, with the same product (HOLDING it if PRODUCT type per <attachment_classifier>, OR WEARING it if WEARABLE type — clothes/hijab/jewelry/shoes/bag)."
- ONE action + camera movement

MUST have this EXACT spoken dialog structure:
  The character speaks directly to camera:
  ${noCta ? `0-3s: "[hook — max 10 words, informal Bahasa Malaysia]"
  3-8s: "[value/story — max 30 words, informal Bahasa Malaysia]"` : `0-2s: "[hook — max 8 words, informal Bahasa Malaysia]"
  2-6s: "[value/problem-solution — max 20 words, informal Bahasa Malaysia]"
  6-8s: "${shopMode ? `${SHOP_CTA_VARIATIONS[0]}" (or similar beg kuning variation — MUST mention beg kuning)` : customCtaResolved ? `${customCtaResolved}" (use this EXACT text)` : '[your CTA — max 8 words]"'}`}

${noCta ? "" : "CRITICAL: The 6-8s CTA line MUST be present. Without it, the video is INCOMPLETE."}

FOR PRODUCT / LIFESTYLE FRAMEWORKS (8s — NO person on screen):
videoPromptShot1 (max 700 chars — Veo 3.1 Fast spec: total prompt ≤ 2000 chars including locks; custom idea details still take priority — be terse but never drop user's idea content):
- Start: "[Shot type] of the product [${productData.productName || "product"}] on [elegant surface/setting]." NO person, NO face, NO hands, NO body in frame.
- ONE smooth motion: slow rotation / zoom in / floating reveal / volumetric reveal / dramatic lighting shift
- The avatar block is IGNORED — this video is product-only

MUST have voiceover-only audio (no character on screen):
  ${noCta ? `0-3s: "[hook voiceover — max 10 words, informal Bahasa Malaysia]"
  3-8s: "[feature/benefit voiceover — max 30 words, informal Bahasa Malaysia]"` : `0-2s: "[hook voiceover — max 8 words, informal Bahasa Malaysia]"
  2-6s: "[feature/benefit voiceover — max 20 words, informal Bahasa Malaysia]"
  6-8s: "${shopMode ? `${SHOP_CTA_VARIATIONS[0]}" voiceover (or similar beg kuning variation — MUST mention beg kuning)` : customCtaResolved ? `${customCtaResolved}" voiceover (use this EXACT text)` : '[CTA voiceover — max 8 words]"'}`}

Voice: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone.
Style: Premium product lighting, shallow depth of field, cinematic film look. Voiceover audio only — no character speaking on screen because there IS no character on screen. NO background music. NO subtitles.
${noCta ? "" : "CRITICAL: The 6-8s CTA voiceover line MUST be present. Without it, the video is INCOMPLETE."}
`}

EVERY videoPrompt MUST follow ONE of these 2 templates:

=== TEMPLATE A: UGC (character on screen) ===
Use this for UGC frameworks (Hook+Pain, Testimonial, FOMO, BAB, 4Ps, Action Bias, Solution, Benefit+Result, Fear of Loss)

[Shot type], same person from reference image, same appearance, with the same product (HOLDING it if PRODUCT type per <attachment_classifier>, OR WEARING it if WEARABLE type — clothes/hijab/jewelry/shoes/bag). [One action description].

Spoken dialog:
0–2s: "[SHORT Malay hook — max 8 words]"
2–6s: "[Malay value/story — max 20 words]"
${noCta ? `6–8s: "[Malay natural outro / closing thought — max 6 words. NOT a CTA. NOT a buy-now line. Just a closing word, reaction, or lead-in to a future segment so this video stays open-ended for extending later]"` : "[CTA LINE HERE]"}

Tone: [santai/excited/confident]
Voice: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}, cheerful and trendy`}
Style: Soft natural lighting, shallow depth of field, cinematic film look, audio dialogue only, clean vertical frame.

The character speaks directly to camera with clear voice. NO background music, NO instrumental, NO sound effects. All audio is spoken dialog only. NO subtitles or text overlays, NO on-screen dialogue text. ZERO shopping bag icons, ZERO yellow bag icons, ZERO beg kuning icons, ZERO buttons, ZERO UI elements, ZERO emojis, ZERO graphics — "beg kuning" is SPOKEN WORDS ONLY, never rendered as a visual icon or graphic. Reduce contrast, natural skintone, soft highlights, low contrast, soft colors, natural tone, film look, soft light. Clean vertical video frame with no interface overlay, no icons, no overlay elements.

=== TEMPLATE B: PRODUCT SHOT (no person, voiceover only) ===
Use this for Product frameworks (Product Hero, Before/After, USP Showcase, Flat Lay) and Lifestyle (Soft Sell, Evening Routine)

[Shot type] of the product [${productData.productName || "product"}] on [elegant surface/setting]. [One smooth motion — slow rotation, zoom in, floating, reveal detail].

Spoken voiceover:
0–2s: "[SHORT Malay hook — max 8 words]"
2–6s: "[Malay benefit/feature — max 20 words]"
${noCta ? `6–8s: "[Malay natural outro voiceover — max 6 words. NOT a CTA. Just a closing line so this video stays open-ended for extending later]"` : "[CTA LINE HERE]"}

Tone: warm, professional
Voice: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone
Style: Premium product lighting, shallow depth of field, cinematic film look, voiceover audio only, clean vertical frame.

NO person on screen. Product only. NO background music, NO instrumental. Voiceover audio only. NO subtitles or text overlays. ZERO shopping bag icons, ZERO yellow bag icons, ZERO beg kuning icons, ZERO buttons, ZERO UI elements, ZERO emojis, ZERO graphics — "beg kuning" is SPOKEN WORDS ONLY, never rendered as a visual icon or graphic. Reduce contrast, soft highlights, soft colors, film look. Clean vertical video frame.

LANGUAGE RULE (CRITICAL):
- ALL dialog MUST be in BAHASA MELAYU / MALAY language — NEVER Bahasa Indonesia
- NEVER write English dialog
- Use Malaysian markers ONLY: korang, aku, tau, kan, ni, tu, memang, gila, kau, lah, je, dah, eh, macam, serious, confirm
- FORBIDDEN Indonesian words: kalian, gue, lo, banget, sih, dong, kayak, gimana, ngapain, kasihan, doang, mau, nih, tuh
- Dialog must match timing — too many words = Veo cuts off mid-sentence

${providerChoice === "grok" ? `🚨 TOTAL DIALOG LENGTH FOR THIS ${grokDuration}-SECOND GROK SHOT = EXACTLY ${grokDuration * 3} WORDS BM (FIXED 3 words per second — Grok's lip-sync is tuned for this rate):
- 0-2s hook: ~6 words
- mid section: ${grokDuration > 4 ? (grokDuration - 4) * 3 : 0} words (3 words per second over the middle ${Math.max(0, grokDuration - 4)} seconds)
- last 2s outro/CTA: ~6 words
- Sum MUST equal ${grokDuration * 3} words. Under = mouth freezes at end. Over = clipped audio.
- Single shot — Grok renders one continuous clip; no shot 2.

PER-SECOND CAP: 3 words per second (so any N-second slot caps at N × 3 words).` : `🚨 TOTAL DIALOG LENGTH PER 8-SECOND SHOT = 20-24 WORDS BM (HARDCODED):
- 0-2s hook: 4-6 words
- 2-6s core message: 10-14 words
- 6-8s outro/CTA: 4-6 words
- Sum across the shot MUST land in the 20-24 word window. Under 18 = character freezes at end. Over 26 = rushed audio + clipped delivery.
- For 16s = TWO shots × 20-24 words each (40-48 total). Shot 2 inherits Shot 1's voice — same gender/age/pitch/accent — so the merge sounds like one continuous take.

PER-SLOT WORD CAPS (do NOT exceed):
  - 2-second slot: 4-6 words
  - 4-second slot: 10-14 words
  - 6-second slot: 14-18 words`}

Example GOOD 8s shot (22 words): "Korang tau tak rahsia muka glow ni? Aku pakai serum ni 2 minggu, kulit dah anjal balik. Cuba la, korang!" ✓
Example BAD 8s shot (32 words — overshoots): rushed, clipped at end ✗
Example BAD 8s shot (12 words — undershoots): character freezes for 3 seconds ✗
</video_prompt_rules>

<video_action_rules>
CRITICAL — Veo cannot handle complex multi-step actions:
- ONE simple action per shot — never chain multiple actions
- Describe the FINAL STATE, not the process
- BAD: "She opens the jar lid, puts the lid down, picks up spoon, scoops sambal" ✗ (4 actions = anomaly)
- GOOD: "She holds an already-opened jar in left hand, spoon loaded with sambal in right hand" ✓ (1 state)
- BAD: "She walks to table, sits down, picks up product, shows to camera" ✗ (4 actions)
- GOOD: "She sits at table holding product, shows label to camera" ✓ (1 state + 1 action)
- Keep camera movement simple — ONE type per shot (zoom OR pan OR static, never combine)
</video_action_rules>

<diversity_rules>
CRITICAL — ${quantity} videos must ALL be different:
- NO two videos: same hook angle
- NO two videos: same background/setting
- NO two videos: same shot type
- NO two videos: same emotion
- NO two videos: same opening line pattern
- Each video uses DIFFERENT framework
- Vary: emotional/question/shocking/story/direct/whispering/urgent hooks
- Vary: warm/bright/moody/clean/natural/dramatic styles
</diversity_rules>

<caption_rules>
Each video MUST have a unique TikTok caption:
- Written in informal Bahasa Melayu (same style as dialog — korang, aku, ni, memang)
- 2-3 sentences max — short, punchy, scroll-stopping
- Match the framework angle (FOMO = urgency, Testimonial = personal story, etc.)
- End with EXACTLY 5 viral hashtags — no more, no less
- Hashtags strategy — 1 from each category:
  1. Product category (e.g. #PerfumeLelaki #DeodoranNatural #SerumMuka)
  2. Product benefit (e.g. #WangiTahan #KulitGlowing #HilangBauBadan)
  3. Problem/solution (e.g. #BauKetiak #JerawatHilang #RambutGugur)
  4. Malaysian trending (e.g. #TikTokShopMalaysia #FYPMalaysia #ViralMY)
  5. Buying intent (e.g. #MestCuba #RecoJujur #BerbaloBeli #ReviewJujur)
- ZERO duplicate hashtags across videos — every video MUST have 5 COMPLETELY DIFFERENT hashtags
- If batch has 10 videos = 50 unique hashtags total, NO repeats
- Think: what would a Malaysian buyer SEARCH on TikTok to find this product?
</caption_rules>

<cover_text_rules>
Cover text is the SCROLL-STOPPER on TikTok feed. It must be a HOOK, not a product label.
Together coverTitle + coverSubtitle form ONE viral hook sentence split across 2 lines.
Target: viewer sees thumbnail → feels "eh kena tengok ni" → clicks.

coverTitle (EXACTLY 2 WORDS — the BIG top line, font 23):
- MUST be a PAIN QUESTION, INTERRUPT WORD, or BOLD CLAIM — NEVER the product name.
- Examples (copy this energy):
  • "GATAL BAU?"        • "ASYIK SEMPIT?"       • "RASA KETAT?"
  • "STOP!"              • "BAU BUSUK?"           • "MUKA BERJERAWAT?"
  • "MASALAH NI?"       • "PENAT TAU?"           • "SAKIT PERUT?"
  • "JANGAN SCROLL!"    • "KULIT KUSAM?"         • "TAK CONFIDENT?"
  • "MAHAL KAN?"         • "RAMBUT GUGUR?"        • "RASA KECEWA?"
- Format options:
  A) PAIN QUESTION: "[PAIN] ?" — e.g. "GATAL BAU?", "ASYIK SEMPIT?"
  B) INTERRUPT: "STOP!" / "JANGAN SCROLL!" / "EH TUNGGU!"
  C) BOLD CLAIM: "SHOCK BETUL!" / "GAME CHANGER!"
- ALWAYS ends with "?" "!" — creates urgency or curiosity.
- 2 words only. Not 1, not 3. Use hyphens or skip filler words if needed.

coverSubtitle (3-6 words — the SMALL follow-up line below, font 10):
- Completes the hook from coverTitle. Tells the viewer what to DO or WHY to watch.
- Examples (pair with title above):
  • Title "GATAL BAU?"     → Sub: "JANGAN BIAR LAMA!"
  • Title "ASYIK SEMPIT?"   → Sub: "TENGOK NI CEPAT!"
  • Title "STOP!"            → Sub: "KENA TENGOK NI DULU"
  • Title "RASA KETAT?"      → Sub: "JANGAN IGNORE!"
  • Title "BAU BUSUK?"       → Sub: "INI JAWAPAN NYA!"
  • Title "MUKA KUSAM?"      → Sub: "30 HARI BOLEH GLOW"
  • Title "MASALAH NI?"      → Sub: "JANGAN BUAT SILAP LAGI"
  • Title "PENAT TAU?"       → Sub: "AKU PUN DULU MACAM TU"
  • Title "JANGAN SCROLL!"   → Sub: "BENDA NI PENTING GILA"
  • Title "MAHAL KAN?"       → Sub: "HARGA NI SHOCK BETUL"
- Subtitle patterns:
  A) URGENCY: "JANGAN BIAR LAMA!", "CEPAT FIX!", "KENA TENGOK NI"
  B) RESULT/TIMELINE: "30 HARI BOLEH SIAP", "1 MINGGU DAH NAMPAK"
  C) INSTRUCTION: "TENGOK NI DULU", "JANGAN BUAT SILAP"
  D) EMPATHY: "AKU PUN DULU", "KORANG TAK KESEORANGAN"
- ALL CAPS. Informal Bahasa Malaysia. 3-6 words.

COMBINED HOOK EXAMPLES (what your output should look like as a pair):
- Deodorant: "BAU KETIAK?" + "JANGAN BIAR TERUK!"
- Seluar:    "ASYIK SEMPIT?" + "TENGOK SELUAR NI!"
- Pinky wash:"GATAL BAU?" + "JANGAN BIAR LAMA!"
- Supplement:"PENAT GILA?" + "SATU BOTOL, SIAP!"
- Kipas:     "BILIK HABA?" + "KIPAS NI DIAM GILA"
- Sambal:    "NAK RANGUP?" + "INI SAMBAL WAJIB CUBA!"
- Serum:     "MUKA KUSAM?" + "30 HARI GLOW UP!"
- Perfume:   "BAU ORANG KAYA?" + "HARGA SHOCK BETUL!"
- Hijab:     "CEPAT LUSUH?" + "YANG NI TAHAN LAMA!"

RULES (NON-NEGOTIABLE):
- coverTitle ≠ product name. NEVER use "SPRAY DEODORAN", "KIPAS ANGIN", "SAMBAL NYET" etc. on the TITLE.
- The hook (title + subtitle) MUST be DIRECTLY RELATED to what this SPECIFIC product solves — not a random viral hook.
  → If product = deodorant → hook about bau/ketiak/wangi
  → If product = seluar → hook about sempit/selesa/fit
  → If product = serum muka → hook about jerawat/kusam/glow
  → If product = supplement tenaga → hook about penat/lemah/stamina
  → If product = kipas → hook about haba/bising/angin lemah
- Derive the pain/angle from the product's USP, target customer, and common complaint it fixes. Read the product name/description/features carefully and pick the STRONGEST pain point this product addresses.
- The product can be hinted at in coverSubtitle but even better — make the viewer CURIOUS to find out what solves their problem.
- Every video in the batch uses a DIFFERENT hook pair that explores a DIFFERENT angle of the same product pain — no repeats.
- Together the two lines form a complete thought that stops the scroll AND makes the viewer think "eh, ni pasal masalah aku".
</cover_text_rules>

<output_format>
Respond with ONLY valid JSON array. No explanation, no markdown, no code blocks.
[
  {
    "videoIndex": 1,
    "framework": "framework name",
    "targetEmotion": "the emotion this video targets",
    "hookAngle": "what makes this hook unique",
    "imagePrompt": "...",
    "storyboardPrompt": "<300-500 char storyboard prompt — see <storyboard_prompt_rules>>",
    "videoPromptShot1": "...",
    ${is16s ? '"videoPromptShot2": "...",' : ""}
    "caption": "...",
    "coverTitle": "PRODUCT NAME IN CAPS",
    "coverSubtitle": "USP BENEFIT IN CAPS"
  },
  ...
]
</output_format>`;

    const userPrompt = `<product_data>
Product: ${productData.productName}
Price: ${productData.price || "N/A"}
Category: ${productData.category || "N/A"}
Rating: ${productData.rating || "N/A"} stars
Total Sold: ${productData.totalSold || "N/A"}
Specifications: ${JSON.stringify(productData.specifications || {}).substring(0, 800)}
Full Description: ${(productData.descriptionText || "").substring(0, 1000)}
</product_data>

<character_lock>
Gender: ${gender.toUpperCase()} (write "${gender === "male" ? "Malay man" : "Malay woman"}" in every UGC/lifestyle prompt)
Hijab:  ${hijabMode ? "YES — write \"hijab tudung labuh fully covering hair, ears, neck\" in every UGC/lifestyle prompt. ZERO hair visible." : "NO — character has hair visible. NEVER use the word \"hijab\" or \"tudung\"."}
Age:    ${ageRange} (write this exact age in every UGC/lifestyle prompt)
</character_lock>

<outfit_freedom>
🎨 YOU pick a Malaysian-style outfit for EACH video. No pre-assigned table.

For every UGC / lifestyle video pick a Malaysian outfit yourself based on:
  • the scene + framework you've chosen
  • the product category and tone
  • the client's idea_style (if any) — let it guide the vibe
  • previous videos in the batch — never repeat silhouette + colour family

Variation rule — see <clothing_variety> below for the Malaysian options
pool. Across the batch, the outfits MUST span at LEAST ${Math.min(Math.max(quantity, 3), 8)} distinct garment types and ${Math.min(Math.max(quantity, 3), 8)} distinct colour families. No two CONSECUTIVE videos may share garment silhouette OR colour family.
${hijabMode ? "\n🚨 Hijab is locked: every UGC/lifestyle prompt MUST describe the hijab as LOOSE tudung labuh fully covering all hair, ears, neck. Zero hair strands visible. The hijab is never tight, never form-revealing. You pick the colour per video to coordinate with the outfit." : ""}
</outfit_freedom>

<wearable_outfit_override>
🚨 OUTFIT FREEDOM IS BYPASSED WHEN THE PRODUCT ITSELF IS A WEARABLE.

Read your <attachment_classifier> result for each video:

  • If attachment_classifier == PRODUCT (skincare / supplement / food /
    drink / device / accessory held in hand) →
        Use your own Malaysian-style outfit pick. The avatar wears the
        outfit you chose AND holds/uses the product.

  • If attachment_classifier == WEARABLE (clothing / pants / shirt /
    hijab / shoes / bag / jewelry / abaya / watch / scarf) →
        SKIP your outfit pick. The PRODUCT ITSELF is the outfit. The
        avatar wears the product directly. DO NOT layer a second
        outfit on top. Persona base (gender, age, hijab presence)
        still applies. For hijab + female: pick a hijab colour that
        complements the product.

        Example: Product = "black slim-fit pants" + hijab persona →
        prompt reads "A beautiful Malay woman in her 30s, wearing a
        LOOSE soft grey hijab tudung labuh, WEARING the black
        slim-fit pants product (the product is the outfit — no
        separate blouse on top), standing in [scene], …"

        DO NOT write "wearing baju kurung AND the pants product" —
        the PRODUCT IS THE OUTFIT. Period.

        Hijab-aurat rule still applies for wearable bottoms: if the
        product is form-fitting pants/leggings/shorts, the avatar
        wears a LONG MODEST TOP (tunic / blouse / kurung-style top)
        that covers the hips, so body shape stays covered. The
        wearable bottom + a modest covering top together satisfy
        aurat.
</wearable_outfit_override>

<per_video_prefix>
EVERY UGC + LIFESTYLE video's imagePrompt and videoPromptShot1${is16s ? " and videoPromptShot2" : ""} MUST START with this exact person-lock phrase:

"${requiredPrefix()}"

Then YOU append a Malaysian-style outfit clause (from <clothing_variety>) that is DIFFERENT from previous videos in the batch.

After that, add the product-interaction phrase BASED ON THE attachment_classifier:
  • PRODUCT (consumable / bottle / packet / box / device / accessory held in hand) → ", wearing [your Malaysian outfit pick], holding the product, [shot type + action + setting]. Spoken dialog: ..."
  • WEARABLE (clothing / pants / shirt / hijab / shoes / bag / jewelry / abaya / watch / scarf) → ", WEARING the product (NOT holding it — the character is physically dressed in / wearing / has it on their body), [shot type + action + setting]. Spoken dialog: ..."

🚨 CRITICAL FOR WEARABLE: NEVER write "holding", "holds", "shows", "displays" with a wearable item. The character must be PHYSICALLY WEARING it:
  • Pants/jeans/skirt → wearing the pants, standing/sitting/walking
  • Shirt/blouse/top → wearing the shirt, normal upper-body shot
  • Hijab/tudung → wearing the hijab on her head (covering hair)
  • Shoes → wearing the shoes (visible on feet)
  • Bag → wearing the bag over shoulder / cross-body / handbag style
  • Jewelry → wearing the necklace / earrings / ring / watch on body
  • Abaya/baju kurung → wearing the dress / full outfit

WRONG for wearable pants: "Malay man holding black pants and showing them to camera" ✗
RIGHT for wearable pants: "Malay man wearing the black pants, standing in a bright room, gesturing to his outfit" ✓

For PRODUCT (Template B) and HAND-POV (Template C) videos: SKIP the prefix entirely — no character description, no gender, no hijab, no age. Those videos show product or hand only.
</per_video_prefix>

Plan ${quantity} unique viral TikTok videos for this product.

CRITICAL OUTPUT RULES:
1. Respond with ONLY a JSON array. NO analysis, NO explanation, NO markdown, NO text before or after the JSON. Start your response with [ and end with ].
2. Every UGC + lifestyle video's imagePrompt and videoPromptShot1 MUST start with the person-lock prefix above, then YOUR chosen Malaysian outfit clause.
3. Every UGC/lifestyle video must contain the gender word "${gender === "male" ? "Malay man" : "Malay woman"}", the age "${ageRange}", and ${hijabMode ? '"hijab" (described as LOOSE tudung labuh fully covering hair/ears/neck)' : "MUST NOT contain the word \"hijab\""}.
4. No two CONSECUTIVE videos may share garment silhouette OR colour family. Across the batch the outfits must span at LEAST ${Math.min(Math.max(quantity, 3), 8)} distinct garment types.`;

    // Text-only call — extension uses orChat (no vision). Product OCR done
    // separately above and folded into productData.descriptionText.
    // Routes through model_custom_idea (shared with UGC tab Custom Idea
    // expansion since both do "expand brief → structured Veo prompt").
    // Falls back to model_auto when admin hasn't set a dedicated model.
    const plan = await orChat({
      modelKey: "model_custom_idea",
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      maxTokens: Math.max(4000, Math.min(quantity * 800, 32000)),
      // Tag for admin Usage Chat log — `auto_with_idea` when the user
      // typed a custom idea (idea_style), else plain `auto_only`. Lets
      // admin distinguish the three Custom-Idea-cascade flows in one
      // log: UGC tab Custom Idea / Auto + idea / Auto only.
      logFeature: ideaStyle ? "auto_with_idea" : "auto_only",
      logUserId: user?.id || null,
    });
    if (!plan.ok || !plan.content) {
      return NextResponse.json({ error: plan.error || "Master plan failed" }, { status: 502 });
    }

    // Parse JSON array (with markdown-fence + truncation + prose-prefix
    // recovery). Qwen Flash 3.6 sometimes prepends labels like
    // "[UGC] - TEMPLATE A:" or human-readable summaries BEFORE the JSON.
    // The naive "first '[' → last ']'" approach grabs those bracketed
    // tags and corrupts the substring. So we hunt for the actual JSON
    // array opener — `[` followed by optional whitespace then `{` — and
    // fall back to the naive approach only if we can't find that.
    try {
      let cleaned = plan.content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
      }

      // Strip any prose preamble: find the first "[" that's followed by
      // optional whitespace + "{". That's the start of the videos array.
      // Anything before it (including bracketed tags like [UGC]) is
      // chatter we can safely drop.
      const arrayOpenMatch = cleaned.match(/\[\s*\{/);
      const start =
        arrayOpenMatch && arrayOpenMatch.index !== undefined
          ? arrayOpenMatch.index
          : cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start >= 0 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
      } else if (plan.finishReason === "length") {
        const lastClose = cleaned.lastIndexOf("},");
        if (lastClose > 0) cleaned = cleaned.substring(0, lastClose + 1) + "]";
      }
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Empty plan");

      plans = parsed.slice(0, quantity).map((p: any, i: number): Plan => {
        const fwName = String(p.framework || frameworkRotation[i]?.name || `Video ${i + 1}`);
        const fwMatch = FRAMEWORKS.find(
          (f) => f.name.toLowerCase().split(" ")[0] === fwName.toLowerCase().split(" ")[0]
        );
        return {
          framework: fwName,
          frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
          needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
          targetEmotion: String(p.targetEmotion || ""),
          hookAngle: String(p.hookAngle || ""),
          imagePrompt: String(p.imagePrompt || ""),
          storyboardPrompt: String(p.storyboardPrompt || ""),
          videoPromptShot1: String(p.videoPromptShot1 || ""),
          videoPromptShot2: String(p.videoPromptShot2 || ""),
          caption: String(p.caption || ""),
          coverTitle: String(p.coverTitle || "").toUpperCase(),
          coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
        };
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: `Master plan parse failed: ${e?.message}` },
        { status: 502 }
      );
    }

    if (plans.length === 0 || plans.every((p) => !p.videoPromptShot1)) {
      return NextResponse.json({ error: "Empty master plan" }, { status: 502 });
    }

    // Caption + hashtag normalization — port of creative-hack-auto's
    // post-LLM repair pass. Empty or short captions get auto-filled
    // from coverTitle + coverSubtitle + product name + 5 generic
    // hashtags so the auto-post step never breaks. Captions with fewer
    // than 5 hashtags get padded; captions with more than 5 get
    // trimmed (extension's behaviour: EXACTLY 5).
    const FALLBACK_HASHTAGS = [
      "#TikTokShopMalaysia",
      "#ViralMY",
      "#MestiCuba",
      "#ReviewJujur",
      "#FYPMalaysia",
    ];
    plans = plans.map((p, i) => {
      let caption = String(p.caption || "").trim();

      // Fallback if missing/too short.
      if (caption.length < 20) {
        const title = (p.coverTitle || "").trim();
        const sub = (p.coverSubtitle || "").trim();
        const prodShort = (productName || "Product").substring(0, 40);
        caption = [
          title && sub ? `${title} ${sub}` : "Korang kena try ni!",
          `Aku pakai ${prodShort}, memang berbaloi!`,
          FALLBACK_HASHTAGS.join(" "),
        ].join(" ");
      }

      // Enforce exactly 5 hashtags. Walk hash tokens from the end of
      // the caption. If <5 → pad with fallbacks (skipping duplicates).
      // If >5 → keep the first 5 in document order.
      const tokens = caption.split(/\s+/);
      const hashIdxs = tokens
        .map((t, idx) => (t.startsWith("#") ? idx : -1))
        .filter((idx) => idx >= 0);

      if (hashIdxs.length > 5) {
        const drop = new Set(hashIdxs.slice(5));
        caption = tokens.filter((_, idx) => !drop.has(idx)).join(" ");
      } else if (hashIdxs.length < 5) {
        const existing = new Set(
          hashIdxs.map((idx) => tokens[idx].toLowerCase())
        );
        const need = 5 - hashIdxs.length;
        const pad: string[] = [];
        for (const tag of FALLBACK_HASHTAGS) {
          if (!existing.has(tag.toLowerCase())) pad.push(tag);
          if (pad.length === need) break;
        }
        caption = `${caption.trim()} ${pad.join(" ")}`.trim();
      }

      return {
        ...p,
        caption,
      };
    });
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

  // Pick the per-video product image: prefer manualProducts[i % len]
  // (populated by BOTH manual mode AND the affiliate scrape — the scrape
  // fills slot 0 then the user can add up to 2 more attachments on the
  // same card). Falls back to single productImageUrl only when manual
  // products are truly empty.
  function imageForVideo(i: number): string {
    if (manualProducts.length) {
      const mp = manualProducts[i % manualProducts.length];
      const fromArr = (mp.imageUrls || []).filter(Boolean)[0];
      if (fromArr) return fromArr;
      if (mp.imageData) return mp.imageData;
    }
    return productImageUrl;
  }

  // Distinct attachment URLs per video — no triplication. 1 picked
  // → 1 sent, 2 → 2, 3 → 3. Both Veo r2v and Grok i2v handle 1+
  // distinct refs natively; the prior [u,u,u] anchor trick is no
  // longer needed.
  function imagesForVideo(i: number): string[] {
    if (manualProducts.length) {
      const mp = manualProducts[i % manualProducts.length];
      const arr = (mp.imageUrls || []).filter(Boolean);
      const usable = arr.length ? arr : (mp.imageData ? [mp.imageData] : []);
      if (usable.length) return usable.slice(0, 3);
    }
    if (productImageUrl) return [productImageUrl];
    return [];
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

  // Persist the master plan as a saved_prompts row in bucket "master-auto"
  // so the user can revisit / star it from the Saved Prompts library.
  //
  // Shape MATCHES the reference creative-hack-auto extension exactly:
  // bare array, key order { imagePrompt, videoPromptShot1, videoPromptShot2,
  // caption, frameworkName, frameworkType, needsCharacterImage, hookAngle,
  // targetEmotion, coverTitle, coverSubtitle }. The reference renames our
  // `framework` field to `frameworkName` — we map at save-time so the
  // copied JSON pastes straight into the extension's manual auto-plan
  // textarea without any field renaming.
  //
  // Best-effort — failure here never breaks the generation path.
  try {
    // imagePrompt dropped — Auto Content always runs in noImageMode=true
    // (the uploaded product image IS the r2v reference, no separate
    // image gen). Keeping it in the saved JSON only invites confusion.
    const exportShape = plans.map((p) => ({
      videoPromptShot1: p.videoPromptShot1 || "",
      videoPromptShot2: p.videoPromptShot2 || "",
      caption: p.caption || "",
      frameworkName: p.framework || "",
      frameworkType: p.frameworkType || "ugc",
      needsCharacterImage: p.needsCharacterImage ?? true,
      hookAngle: p.hookAngle || "",
      targetEmotion: p.targetEmotion || "",
      coverTitle: (p.coverTitle || "").toUpperCase(),
      coverSubtitle: (p.coverSubtitle || "").toUpperCase(),
    }));
    const planJson = JSON.stringify(exportShape, null, 2);
    await admin.from("saved_prompts").insert({
      user_id: user.id,
      project_id: projectId,
      bucket: "master-auto",
      prompt_text: planJson,
      model: "veo-3.1",
      scene_template: `Auto Content plan · ${plans.length} videos · ${durationMode}s · ${ctaMode}`,
      reference_url: productImageUrl || null,
      duration: durationMode === "16" ? 16 : 8,
      aspect_ratio: aspectRatio,
      cost: videoRate * plans.length,
      outcome: "success",
      source: "auto-content",
    });
  } catch (e) {
    console.error("[auto-content] master-plan saved_prompts insert failed:", e);
  }

  // Pick the locked Veo voice ID once per batch based on (gender, age)
  // so every video AND every Extend continuation uses the same exact
  // voice character — matches how UGC tab works. The picker resolves
  // to a real Veo catalog entry like "callirrhoe" / "achird" / "leda"
  // / "gacrux"; buildVeoLocks then expands that into the canonical
  // "VOICE CHARACTER (LOCKED): Callirrhoe — Female, easy-going, mid-
  // pitch. Natural conversational tone." line that Veo's TTS treats
  // as a hard constraint.
  const lockedVoiceId = pickAutoContentVoice(
    avatarGender === "male" ? "male" : "female",
    (avatarAge || "30s") as AutoContentAge
  );

  // For 16s clips we now use the segment chain (lib/segment-chain.ts):
  // fire seg-1 with Shot 1 only, store Shot 2 in metadata.seg2_prompt,
  // and let onSegmentSettled pick it up after seg-1 lands. The chain
  // handles the frame extract + seg-2 fire + ffmpeg merge automatically.
  // For 8s clips, Shot 1 is the only prompt. Locks appended either way.
  // For Veo this is the canonical 8s shot. For Grok, the user's slider
  // (8-30s) sets the duration AND the DIALOG LENGTH LOCK target
  // (rule: N seconds × 3 words). buildVeoLocks reads durationSec and
  // emits "MUST be N×3 ±2 Malay words" so the LLM has a hard target.
  function veoSeg1PromptFor(p: Plan, voiceLine: string): string {
    return (
      p.videoPromptShot1 +
      buildVeoLocks({
        voiceId: lockedVoiceId,
        voiceLine, // legacy fallback if voiceId ever fails to resolve
        hijab: hijabMode,
        durationSec: providerChoice === "grok" ? grokDuration : 8,
      })
    );
  }

  // CODE-LEVEL guarantee that seg-2's prompt == seg-1's prompt with ONLY
  // the dialog block swapped. The LLM is asked to produce shot 2 as
  // either (a) a "shot2_dialog_only" string (just the new dialog beats)
  // OR (b) a full videoPromptShot2 — but in either case we ignore
  // everything except its dialog and rebuild shot-2 from shot-1.
  //
  // Veo has zero memory between segment fires, so seg-2 must contain
  // the full scene/character/outfit/product description identically to
  // seg-1. The only difference between the two prompts should be the
  // dialog beats; everything else is a verbatim copy.
  function extractDialogBlock(prompt: string): string {
    // Match "Spoken dialog:" or "Spoken voiceover:" line + the lines
    // that follow until the next labelled section starts.
    const m = prompt.match(
      /(?:Spoken (?:dialog|voiceover)):\s*\n([\s\S]*?)(?=\n(?:Tone:|Voice:|Style:|The character speaks|Audio:|MUST USE|CRITICAL|NO background|$))/i
    );
    return m ? m[1].trim() : "";
  }
  function swapDialogBlock(shot1Prompt: string, newDialog: string): string {
    if (!newDialog.trim()) return shot1Prompt;
    return shot1Prompt.replace(
      /((?:Spoken (?:dialog|voiceover)):\s*\n)([\s\S]*?)(?=\n(?:Tone:|Voice:|Style:|The character speaks|Audio:|MUST USE|CRITICAL|NO background|$))/i,
      (_full, marker) => `${marker}${newDialog.trim()}\n`
    );
  }
  function veoSeg2PromptFor(p: Plan, voiceLine: string): string {
    // Per user rule: seg-2 is "fully 100% copy from segment 1 prompt"
    // with ONLY the dialog block swapped. Don't re-run any picker, don't
    // re-emit locks separately — start from the already-locked seg-1
    // string, find the "Spoken dialog:" / "Spoken voiceover:" block,
    // replace just that. Voice lock, anatomy lock, hijab lock, dialog-
    // length lock, negatives — all inherited verbatim from seg-1, so
    // there is exactly zero drift between segments.
    const seg1Full = veoSeg1PromptFor(p, voiceLine);
    const dialogSource =
      (p as any).shot2DialogOnly ||
      (p as any).shot2_dialog_only ||
      extractDialogBlock(p.videoPromptShot2 || "") ||
      "";
    if (!dialogSource) return seg1Full; // no new dialog → identical to seg-1
    return swapDialogBlock(seg1Full, dialogSource);
  }

  // Resolve the locked voice description at the outer scope so every
  // generation in this batch (and any future Extend) uses the same
  // exact voice. Mirrors the inner-scope voiceBlock used by the LLM
  // master plan generator earlier in the file.
  const lockedGender = avatarGender === "male" ? "male" : "female";
  const lockedAgeRange =
    avatarAge === "20s"
      ? "20s young adult"
      : avatarAge === "40s"
        ? "40s makcik"
        : avatarAge === "55+"
          ? "50s nenek"
          : "30s";
  const lockedVoiceLine =
    (lockedGender === "male"
      ? `Malay man voice in his ${lockedAgeRange}, confident warm tone, casual pace, mid-range pitch`
      : `Malay woman voice in her ${lockedAgeRange}, warm friendly tone, casual pace, mid-range pitch`) +
    ". Clear studio-quality recording, crisp consonants, natural treble, no muffling.";

  // Grok always single-shot at the user's chosen N seconds; segment
  // chain is Veo-only. is16s gates ALL 2-shot behaviour.
  const is16s = providerChoice === "veo" && durationMode === "16";
  const histories: any[] = [];
  await Promise.all(
    plans.map(async (item, idx) => {
      const refImages = imagesForVideo(idx);
      const refImage = refImages[0] || "";
      const useIngredient = refImages.length > 0;

      // ── GeminiOmni 2-stage path ────────────────────────────────────
      // When the user picks GeminiOmni: first generate a key-frame
      // storyboard via GPT Image 2 (using the user's refs + the master
      // plan's storyboardPrompt), then animate that single storyboard
      // image through GeminiOmni. Storyboard URL is cached on metadata
      // so resubmit can skip the RM 0.30 redo.
      let geminiStoryboardUrl: string | null = null;
      let geminiStoryboardAttempts = 0;
      let geminiStoryboardError: string | null = null;
      let geminiStoryboardUsedPrompt = "";
      if (providerChoice === "gemini") {
        const sbPrompt =
          (item.storyboardPrompt && item.storyboardPrompt.trim()) ||
          buildStoryboardFallback(item);
        geminiStoryboardUsedPrompt = sbPrompt;
        const sbResult = await runStoryboardCascadeWithRetry({
          prompt: sbPrompt,
          aspectRatio,
          imageUrls: refImages,
        });
        geminiStoryboardAttempts = sbResult.attempts;
        if (sbResult.ok) {
          const polled = await pollImageTaskUntilDone({
            taskId: sbResult.taskId,
            slot: sbResult.slot,
          });
          if (polled.ok) {
            geminiStoryboardUrl = polled.outputUrl;
          } else {
            geminiStoryboardError = polled.error;
          }
        } else {
          geminiStoryboardError = sbResult.error;
        }

        // Storyboard failure → insert failed row and return (no video call).
        if (!geminiStoryboardUrl) {
          await admin.from("history").insert({
            user_id: user.id,
            project_id: projectId,
            type: "auto-content",
            tab: "auto",
            status: "failed",
            prompt: veoSeg1PromptFor(item, lockedVoiceLine),
            caption: item.caption || "",
            framework: item.framework || `Video ${idx + 1}`,
            reference_url: refImage || null,
            task_id: null,
            duration: 10,
            cost: 0,
            batch_id: batch?.id,
            error_message: geminiStoryboardError || "Storyboard generation failed",
            metadata: {
              idx,
              modelChoice: "gemini",
              // Stamp the canonical model id even on storyboard-failure
              // so manual Resubmit's meta.model shortcircuit picks the
              // right model. Without this, retry/route.ts falls through
              // to cfg.videoR2V (Veo) and fires it at the gemini cascade
              // pool — which Crun rejects.
              model: "google/gemini-omni",
              providerChoice,
              storyboard_attempts: geminiStoryboardAttempts,
              storyboardPrompt: geminiStoryboardUsedPrompt,
              image_urls: refImages,
              framework: item.framework,
              framework_type: item.frameworkType,
              target_emotion: item.targetEmotion,
              hook_angle: item.hookAngle,
              image_prompt: item.imagePrompt,
              video_prompt_shot1: item.videoPromptShot1,
              video_prompt_shot2: item.videoPromptShot2,
              idea_style: ideaStyle || undefined,
              product_name: productName || null,
              tiktok_product_id: tiktokProductId || null,
              cover_title: item.coverTitle,
              cover_subtitle: item.coverSubtitle,
              imageMode: useIngredient ? "ingredient" : "text",
            },
          });
          return; // Skip the video call for this row.
        }
      }
      // ── End GeminiOmni 2-stage path ────────────────────────────────

      // providerChoice='grok' now routes to Sora 2 (model='sora2'). The
      // UI relabels the Grok button as "⚡ Sora 2" but keeps the internal
      // state key as "grok" to avoid a wide backend refactor — every
      // existing providerChoice='grok' branch stays in place; only the
      // MODEL STRING sent to the cascade changes from 'grok-imagine'
      // → 'sora2'. lib/p6.ts apipodVideoModel detects 'sora' keyword and
      // emits 'sora-2-vip' as the API model id.
      // GeminiOmni uses model='google/gemini-omni' + asset='gemini' (the
      // dedicated Gemini cascade pool wired in Tasks 1-14).
      const model =
        providerChoice === "gemini"
          ? "google/gemini-omni"
          : providerChoice === "grok"
            ? "sora2"
            : useIngredient
              ? cfg.videoR2V
              : cfg.videoT2V;
      const seg1Prompt = veoSeg1PromptFor(item, lockedVoiceLine);
      const seg2Prompt = is16s
        ? veoSeg2PromptFor(item, lockedVoiceLine)
        : "";

      // For GeminiOmni: img_urls = [storyboardUrl] (single image, not
      // the user's raw refs). Other providers pass the raw refs through.
      const videoRefs: string[] =
        providerChoice === "gemini"
          ? [geminiStoryboardUrl!]
          : refImages;
      const videoImageMode: "ingredient" | "text" =
        providerChoice === "gemini"
          ? "ingredient" // Gemini's only mode for refs
          : useIngredient
            ? "ingredient"
            : "text";

      // Veo → video cascade. Sora 2 → sora2 cascade. GeminiOmni →
      // gemini cascade. Each pool has independent main+fallback config
      // at /admin/settings and its own round-robin counter.
      const cascaded = await generateVideoWithCascade({
        primaryModel: model,
        userId: user.id,
        prompt: seg1Prompt,
        imageUrls: videoRefs,
        durationMode:
          providerChoice === "gemini"
            ? "10"
            : providerChoice === "grok"
              ? String(grokDuration)
              : is16s
                ? "8"
                : durationMode,
        aspectRatio,
        imageMode: videoImageMode,
        asset:
          providerChoice === "gemini"
            ? "gemini"
            : providerChoice === "grok"
              ? "sora2"
              : "video",
      });

      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto",
          status: cascaded.ok ? "pending" : "failed",
          prompt: seg1Prompt,
          caption: item.caption || "",
          framework: item.framework || `Video ${idx + 1}`,
          reference_url: refImage || null,
          task_id: cascaded.ok ? cascaded.taskId : null,
          // Grok: actual per-second duration. Veo: 8 or 16. Gemini: 10.
          duration:
            providerChoice === "gemini"
              ? 10
              : providerChoice === "grok"
                ? grokDuration
                : is16s
                  ? 16
                  : 8,
          // Gemini: storyboard cost + video cost (both real money).
          // Veo / Sora 2: video only.
          cost:
            providerChoice === "gemini"
              ? videoRate + storyboardRate
              : videoRate,
          batch_id: batch?.id,
          // 16s chain fields — onSegmentSettled reads these to fire seg-2.
          segment_index: is16s ? 1 : null,
          frame_anchor: is16s ? "last" : null,
          error_message: cascaded.ok ? null : cascaded.error,
          metadata: {
            idx,
            model: cascaded.ok ? cascaded.actualModel : model,
            provider: cascaded.ok ? cascaded.actualProvider : "p2",
            slot: cascaded.ok ? cascaded.actualSlot : undefined,
            ...(cascaded.ok && cascaded.keyIndex !== undefined
              ? { p6_key_index: cascaded.keyIndex }
              : {}),
            // Full attachment array — ALL refs the user picked, not
            // just the first. Auto-cron / retry / manual Resubmit
            // read this back via metadata.image_urls and re-fire the
            // cascade with the SAME image set. Previously this stamped
            // only [refImage] (the first slot), so a retry on a 3-ref
            // generation would silently drop refs 2 and 3.
            image_urls: refImages,
            fallback_used: cascaded.ok ? cascaded.fallbackUsed : false,
            tier_log: cascaded.tierLog,
            batch_id: batch?.id,
            framework: item.framework,
            framework_type: item.frameworkType,
            target_emotion: item.targetEmotion,
            hook_angle: item.hookAngle,
            image_prompt: item.imagePrompt,
            video_prompt_shot1: item.videoPromptShot1,
            video_prompt_shot2: item.videoPromptShot2,
            // Stamp the client-provided idea so the history card can
            // surface it as a label (rainbow badge alongside framework).
            // Empty when user used Normal Flow — the card-side check
            // hides the badge in that case.
            idea_style: ideaStyle || undefined,
            // Provider chip + tracking on the history card. Sora 2 rows
            // (providerChoice='grok' internally for backward compat)
            // stamp modelChoice='sora2' so settle.ts + auto-resubmit
            // route them back through the sora2 cascade pool.
            providerChoice,
            ...(providerChoice === "grok"
              ? {
                  modelChoice: "sora2",
                  grok_duration: grokDuration, // legacy field name
                  sora2_duration: grokDuration,
                }
              : {}),
            // GeminiOmni 2-stage metadata — storyboard fields so
            // settle.ts + retry route can reuse the cached storyboard
            // image instead of regenerating it on resubmit (saves
            // ~RM 0.30 per retry). modelChoice='gemini' routes the row
            // through the gemini cascade pool on auto-retry.
            ...(providerChoice === "gemini"
              ? {
                  modelChoice: "gemini",
                  storyboard_url: geminiStoryboardUrl,
                  storyboard_cost: storyboardRate,
                  storyboard_attempts: geminiStoryboardAttempts,
                  storyboardPrompt: geminiStoryboardUsedPrompt,
                  video_cost: videoRate,
                }
              : {}),
            // Segment chain — duration_mode + seg2_prompt + voice_line
            // are what segment-chain.ts onSegmentSettled needs to fire
            // seg-2 automatically when seg-1 settles. ONLY stamped for
            // Veo 16s rows; Grok is single-shot so the chain is skipped.
            ...(is16s
              ? {
                  duration_mode: "16s",
                  seg2_prompt: seg2Prompt,
                  voice_line: lockedVoiceLine,
                  aspectRatio,
                  hijab: hijabMode,
                }
              : {}),
            // Fields the creative-hack-auto extension's auto-post step
            // reads: cover_title, cover_subtitle, caption (on the row
            // itself), product_name, tiktok_product_id. Saved here so
            // the extension can post directly from history without
            // round-tripping through any intermediate state.
            product_name: productName || null,
            tiktok_product_id: tiktokProductId || null,
            cover_title: item.coverTitle,
            cover_subtitle: item.coverSubtitle,
            imageMode:
              providerChoice === "gemini"
                ? "ingredient"
                : useIngredient
                  ? "ingredient"
                  : "text",
          },
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
