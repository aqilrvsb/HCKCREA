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
    const hijabMode = avatarHijab === "hijab";
    const shopMode = ctaMode === "shop";
    const noCta = ctaMode === "none";
    const customCtaResolved = ctaMode === "custom" ? customCta : "";

    const is16s = durationMode === "16";

    let ctaInstruction: string;
    if (noCta) {
      ctaInstruction = "NO CTA — use full 8 seconds for content. Timing: 0-3s hook, 3-8s middle. No closing CTA needed.";
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
    const outfitDescription = hijabMode
      ? gender === "male"
        ? "neat modern casual outfit"
        : "hijab and modest long-sleeve outfit (planner picks color + pattern to match scene)"
      : gender === "male"
        ? "casual modern outfit, short hair neatly styled"
        : "casual modern outfit, hair visible, no hijab";
    const characterBlock =
      (gender === "male"
        ? "a handsome attractive Malay man with sharp features and clear skin"
        : "a beautiful attractive Malay woman with clear glowing skin") +
      `, age ${ageRange}, wearing ${outfitDescription}`;
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
Duration: ${is16s ? "16 seconds — ONE continuous story split into 2 shots (Shot 1: 0-8s, Shot 2: 8-16s). NOT two separate videos. Same scene, same voice, story continues seamlessly." : "8 seconds — one single shot"}
Character: ${gender === "male" ? "Malay man" : "Malay woman"}${hijabMode ? ", wearing hijab tudung labuh" : ", casual modern no hijab"}
Age: ${ageRange}
CTA: ${ctaInstruction}
Market: Malaysian TikTok (Malay-speaking, informal)
</content_settings>

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

EVERY videoPromptShot1 and videoPromptShot2 must include — CONCISELY — these elements exactly once (no duplication):

1. ONE character line: "${characterBlock}"
2. ONE voice line: "${voiceBlock}"
3. ONE setting line: [single sentence describing the scene — match the product's natural environment]
4. ONE action/dialog timeline per shot (timestamps are LOCAL to that 8-second shot, always 0-8s within the shot):
   - 0-2s hook: max 6 words
   - 2-6s middle: max 12 words
   - 6-8s CTA: max 6 words
   (For 16s videos: shot 1's 6-8s is NOT the CTA — use mid-story line; the CTA goes in shot 2's 6-8s only.)
5. ONE anatomy + voice lock sentence: "Anatomically perfect: 2 hands, 5 fingers, no extra limbs. Audio: ONE single voice only, no background voices, no chatter, no friends."
6. ONE clean rule (MANDATORY anti-subtitle + anti-icon wording — Veo auto-captions TikTok content unless explicitly told not to): "RAW UNEDITED FOOTAGE AESTHETIC: this is a raw camera recording, NOT a published TikTok post. Bottom 25% of frame is COMPLETELY EMPTY. Zero subtitles, zero captions, zero auto-generated dialog text, zero TikTok-style animated captions, zero sticker text, zero pop-up text bubbles, zero closed captions, zero icons, zero emojis, zero graphics, zero overlays, zero watermarks, zero UI elements, zero handles, zero hashtags. The phrase 'beg kuning' is SPOKEN DIALOG ONLY — NEVER a yellow bag icon, shopping bag graphic, button, or visual element. Treat output like a camera recording a moment, NOT a TikTok post. Frame shows ONLY the person, the product, and the real-world setting."
7. ONE product lock: "Product must be pixel-identical to the product reference — no color/shape/label changes."

Keep EACH shot prompt under 1000 characters. Do NOT repeat the voice description — it goes in step 2 ONLY. Do NOT wrap dialog in extra quotation layers. Use natural Malay sentences that fit the timing window (too many words = audio generation fails).
</no_image_mode_rules>
` : ""}

<frameworks>
${fwPoolFinal.map((fw, i) => `${i + 1}. ${fw.name} (${fw.type}) — ${fw.focus}`).join("\n")}
</frameworks>

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
ABSOLUTE RULE — DO NOT OVERRIDE:
The user has CHOSEN this avatar. Even if the product seems like it's for a different gender, USE THIS AVATAR.
Example: product = "dompet lelaki" but user chose Female avatar → use FEMALE avatar (she is promoting/reviewing the product).

ONE avatar for ALL videos:
- Gender: ${gender.toUpperCase()} — LOCKED, NEVER change
- ${hijabMode ? "HIJAB: YES — hijab tudung labuh in EVERY image/video. NON-NEGOTIABLE." : "NO HIJAB — casual modern, hair visible"}
- Age: ${ageRange}
- BEAUTY LOCK: ${gender === "male" ? "Handsome attractive Malay man — sharp jawline, clear skin, confident friendly presence, well-groomed. State \"handsome attractive Malay man with sharp features and clear skin\" in every imagePrompt and videoPrompt." : "Beautiful attractive Malay woman — clear glowing skin, warm natural smile, confident gentle presence, well-groomed. State \"beautiful attractive Malay woman with clear glowing skin\" in every imagePrompt and videoPrompt."}
- SAME person in ALL videos within this batch. Only change: outfit + setting.
</locked_avatar>

<image_prompt_rules>
EVERY video MUST have an imagePrompt (max 600 chars).

FOR UGC FRAMEWORKS (character ONLY — NO product in image):
- Use the LOCKED AVATAR above — same person every time
- ${hijabMode ? "Character MUST wear hijab tudung labuh in EVERY image — NO exceptions" : "Character has visible hair, casual modern look"}
- CHARACTER ONLY — do NOT include any product, phone, or object in the image. HANDS MUST BE EMPTY — not holding anything. No phone, no selfie, no product, no bag, no prop. Hands gently placed in front or relaxed at sides.
- MUST be STANDING or MEDIUM SHOT (waist up minimum) — show body, arms, hands visible. NEVER close-up face only. Facing slightly to the side while looking at camera.
- FACE: Invent a UNIQUE specific attractive face — describe smooth glowing skin, natural makeup (blush, glossy lips, defined brows), specific features (dimples, face shape, skin tone). Make this person look like a REAL beautiful individual. NEVER use generic "oval face, warm brown eyes".
- BACKGROUND: Softly lit elegant indoor setting — warm tones, subtle drapery, soft gradient, or blurred aesthetic backdrop. No mirrors, no reflections, no glass. Clean and premium feel.
- Outfit: ${gender === "male" ? "smart casual — polo shirt / button-up / casual jacket / hoodie (different each video), well-fitted, stylish" : hijabMode ? "elegant modest wear — baju kurung kebaya / blouse+skirt / cardigan / kaftan / modest dress with intricate detailing + ALWAYS hijab (different color each video)" : "elegant casual — blouse / cardigan / dress / casual top (different each video)"}
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
${is16s ? `
16-SECOND VIDEO = ONE continuous story, split into 2 shots that will be merged.
Both shots MUST share: same setting, same product, same framework, same lighting.
ONLY difference: camera angle + dialog continuation.

VOICE LOCK (CRITICAL — DO NOT CHANGE BETWEEN SHOTS):
- Shot 1 and Shot 2 MUST use the EXACT SAME voice: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
- NEVER switch gender between shots. If Shot 1 = female voice, Shot 2 = female voice.
- Copy the EXACT Voice line from Shot 1 into Shot 2.

FOR UGC FRAMEWORKS (16s):
videoPromptShot1 (max 1200 chars) — FIRST HALF (0-8s):
[Shot type], same person from reference image, same appearance, holding the same product. [One action].

Spoken dialog:
0–2s: "[SHORT Malay hook — max 8 words]"
2–8s: "[Malay build-up/story — max 30 words, end mid-sentence to create suspense]"

Tone: [match framework emotion]
Voice: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
Style: Soft natural lighting, cinematic film look, audio dialogue only, clean vertical frame.
The character speaks directly to camera with clear voice. NO background music. NO subtitles.

videoPromptShot2 (max 1200 chars) — SECOND HALF (8-16s):
[Different shot type], same person, same setting, same outfit, continues speaking.

Spoken dialog:
0–4s: "[Malay payoff/proof — max 20 words, continues from Shot 1]"
4–6s: "[Malay benefit — max 10 words]"
${noCta ? '6–8s: "[Malay closing — max 8 words]"' : `6–8s: "${shopMode ? `${SHOP_CTA_VARIATIONS[0]}" (or similar — MUST mention beg kuning)` : customCtaResolved ? `${customCtaResolved}"` : '[Malay CTA — max 8 words]"'}`}

MUST USE EXACT SAME VOICE AS SHOT 1: ${gender === "male" ? "young Malay man voice" : `young Malay woman voice in her ${ageRange}`}
Same tone, style as Shot 1. NO background music. NO subtitles.
CRITICAL: 6-8s CTA MUST be present in Shot 2.

FOR PRODUCT FRAMEWORKS (16s):
videoPromptShot1: [Shot type] of product on [surface]. [Smooth motion].
Spoken voiceover: 0–2s hook, 2–8s feature/benefit. NO CTA in Shot 1.
Voice: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone.

videoPromptShot2: [Different angle]. Same product. [Different motion].
Spoken voiceover: 0–4s payoff, 4–6s benefit, ${noCta ? "6–8s closing." : "6–8s CTA (beg kuning)."}
MUST USE EXACT SAME VOICE AS SHOT 1: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone.
Product only, voiceover only, NO person, NO music.
` : `
8-SECOND VIDEO = ONE complete shot.

videoPromptShot1 (max 1200 chars):
- Start: "[Shot type], same person from reference image, same appearance, holding the same product."
- ONE action + camera movement

MUST have this EXACT spoken dialog structure:
  The character speaks directly to camera:
  ${noCta ? `0-3s: "[hook — max 10 words, informal Bahasa Malaysia]"
  3-8s: "[value/story — max 30 words, informal Bahasa Malaysia]"` : `0-2s: "[hook — max 8 words, informal Bahasa Malaysia]"
  2-6s: "[value/problem-solution — max 20 words, informal Bahasa Malaysia]"
  6-8s: "${shopMode ? `${SHOP_CTA_VARIATIONS[0]}" (or similar beg kuning variation — MUST mention beg kuning)` : customCtaResolved ? `${customCtaResolved}" (use this EXACT text)` : '[your CTA — max 8 words]"'}`}

${noCta ? "" : "CRITICAL: The 6-8s CTA line MUST be present. Without it, the video is INCOMPLETE."}
`}

EVERY videoPrompt MUST follow ONE of these 2 templates:

=== TEMPLATE A: UGC (character on screen) ===
Use this for UGC frameworks (Hook+Pain, Testimonial, FOMO, BAB, 4Ps, Action Bias, Solution, Benefit+Result, Fear of Loss)

[Shot type], same person from reference image, same appearance, holding the same product. [One action description].

Spoken dialog:
0–2s: "[SHORT Malay hook — max 8 words]"
2–6s: "[Malay value/story — max 20 words]"
[CTA LINE HERE]

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
[CTA LINE HERE]

Tone: warm, professional
Voice: ${gender === "male" ? "male Malay voiceover" : "female Malay voiceover"}, warm confident tone
Style: Premium product lighting, shallow depth of field, cinematic film look, voiceover audio only, clean vertical frame.

NO person on screen. Product only. NO background music, NO instrumental. Voiceover audio only. NO subtitles or text overlays. ZERO shopping bag icons, ZERO yellow bag icons, ZERO beg kuning icons, ZERO buttons, ZERO UI elements, ZERO emojis, ZERO graphics — "beg kuning" is SPOKEN WORDS ONLY, never rendered as a visual icon or graphic. Reduce contrast, soft highlights, soft colors, film look. Clean vertical video frame.

LANGUAGE RULE (CRITICAL):
- ALL dialog MUST be in BAHASA MELAYU / MALAY language
- NEVER write English dialog
- Use informal Malay: korang, aku, tau, kan, ni, tu, macam, serious, confirm
- Dialog must match timing — too many words = Veo cuts off mid-sentence
- WORD LIMITS (Bahasa Melayu — short syllable words):
  - 2-second slot: MAX 6-8 words
  - 4-second slot: MAX 20-25 words
  - 6-second slot: MAX 30 words
- Example GOOD 2s: "Ini rahsia cik somi balik awal!" (6 words) ✓
- Example GOOD 4s: "Ramai kawan complain cik somi dia selalu balik lewat. Sebenarnya kalau nak si dia lekat kat rumah, akak-akak kena ada ni dalam bilik." (23 words) ✓
- Example BAD 2s: "Kena tumis lama, kena blend, berpeluh kat dapur, satu jam baru siap" (12 words for 2s) ✗
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

Plan ${quantity} unique viral TikTok videos for this product.

CRITICAL: Respond with ONLY a JSON array. NO analysis, NO explanation, NO markdown, NO text before or after the JSON. Start your response with [ and end with ]. Nothing else.`;

    // Text-only call — extension uses orChat (no vision). Product OCR done
    // separately above and folded into productData.descriptionText.
    const plan = await orChat({
      modelKey: "model_auto",
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      maxTokens: Math.max(4000, Math.min(quantity * 800, 32000)),
    });
    if (!plan.ok || !plan.content) {
      return NextResponse.json({ error: plan.error || "Master plan failed" }, { status: 502 });
    }

    // Parse JSON array (with markdown-fence + truncation recovery)
    try {
      let cleaned = plan.content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
      }
      const start = cleaned.indexOf("[");
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

  // Persist the master plan as a saved_prompts row in bucket "master-auto"
  // so the user can revisit / star it from the Saved Prompts library.
  // Best-effort — failure here never breaks the generation path.
  try {
    const planSummary = plans
      .map(
        (p, i) =>
          `Video ${i + 1} — ${p.framework}\n  hook: ${p.hookAngle || "?"}\n  emotion: ${p.targetEmotion || "?"}\n  cover: ${p.coverTitle || "—"} / ${p.coverSubtitle || "—"}\n  shot1: ${(p.videoPromptShot1 || "").substring(0, 200)}…`
      )
      .join("\n\n");
    await admin.from("saved_prompts").insert({
      user_id: user.id,
      project_id: projectId,
      bucket: "master-auto",
      prompt_text: planSummary || "(empty plan)",
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

  // Build the prompt sent to Veo from the plan's per-shot prompts. For 16s
  // we concatenate Shot 1 and Shot 2 with a clear timeline header — the
  // extension generates them as separate 8s clips and ffmpeg-merges them,
  // but we don't have that segment chain wired for auto-content yet, so we
  // hand the model both shots and let it stitch a 16s output if it can.
  function veoPromptFor(p: Plan): string {
    if (durationMode === "16" && p.videoPromptShot2) {
      return [
        "16-second video — ONE continuous story split into 2 shots:",
        "",
        "SHOT 1 (0-8s):",
        p.videoPromptShot1,
        "",
        "SHOT 2 (8-16s):",
        p.videoPromptShot2,
      ].join("\n");
    }
    return p.videoPromptShot1;
  }

  const histories: any[] = [];
  await Promise.all(
    plans.map(async (item, idx) => {
      const refImage = imageForVideo(idx);
      const useIngredient = !!refImage;
      const model = useIngredient ? cfg.videoR2V : cfg.videoT2V;
      const veoPrompt = veoPromptFor(item);

      const created = await p2CreateTask({
        model,
        prompt: veoPrompt,
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
          prompt: veoPrompt,
          caption: item.caption || "",
          framework: item.framework || `Video ${idx + 1}`,
          reference_url: refImage || null,
          task_id: created.task_id || null,
          duration: durationMode === "16" ? 16 : 8,
          cost: videoRate,
          batch_id: batch?.id,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: {
            idx,
            model,
            provider: created.provider || "p2",
            batch_id: batch?.id,
            framework: item.framework,
            framework_type: item.frameworkType,
            target_emotion: item.targetEmotion,
            hook_angle: item.hookAngle,
            image_prompt: item.imagePrompt,
            video_prompt_shot1: item.videoPromptShot1,
            video_prompt_shot2: item.videoPromptShot2,
            cover_title: item.coverTitle,
            cover_subtitle: item.coverSubtitle,
            imageMode: useIngredient ? "ingredient" : "text",
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
