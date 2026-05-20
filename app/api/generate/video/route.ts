import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { buildVeoLocks, getVoiceDescription, pickVoiceFromPrompt } from "@/lib/veo-voices";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { orChat } from "@/lib/openrouter";
import { FRAMEWORKS } from "@/lib/auto-content-frameworks";

// POST /api/generate/video — UGC tab. Placeholder-first + auth-light.
//
// imageMode: 'frame' = i2v (start frame), 'ingredient' = r2v (ref product),
//            'text'  = t2v (text-only)
//
// Hot-path: getSession (local) → insert pending row → return.
// after():  resolve plan rate + Veo create_task + update row.
//
// Same trust model as /api/generate/image — auth gated by dashboard layout,
// funds gated by nav-tab credit floor. Funds check skipped on hot path.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawInput = String(body?.prompt || "").trim();
  // Input mode: "prompt" (default — legacy verbatim) or "idea" (NEW —
  // backend silently runs Gemini 3.1 Flash Lite to expand the user's
  // one-liner into a full Veo prompt with scene + 20-24 word Malay
  // dialog before applying locks). Same expansion model Auto Content
  // uses minus the framework layer (UGC has no frameworks).
  const inputMode: "prompt" | "idea" = body?.mode === "idea" ? "idea" : "prompt";
  // Provider routing — Veo (default) vs Sora 2. Sora 2 routes through
  // the sora2 cascade asset, uses sora2_rate × duration for cost, and
  // p6.ts auto-transforms the inline 'Spoken dialog:' format into Sora 2's
  // required Dialogue: block. Veo path stays bit-for-bit identical.
  const provider: "veo" | "sora2" = body?.provider === "sora2" ? "sora2" : "veo";
  const imageUrls: string[] = Array.isArray(body?.image_urls) ? body.image_urls : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  // Veo duration is "8" or "16" (16 chains two 8s clips).
  // Sora 2 duration is 8 or 12 (single native clip).
  const durationMode: "8" | "16" = body?.duration === "16" ? "16" : "8";
  const soraDuration: 8 | 12 =
    provider === "sora2" && body?.duration === "12" ? 12 : 8;
  const requestedMode = body?.image_mode as
    | "frame"
    | "ingredient"
    | "text"
    | undefined;
  const imageMode: "frame" | "ingredient" | "text" =
    requestedMode === "frame" || requestedMode === "ingredient" || requestedMode === "text"
      ? requestedMode
      : imageUrls.length ? "ingredient" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;
  // Optional Veo voice id from the manual UI dropdown — used to lock the
  // exact voice character into the AUDIO LOCK.
  const voiceId = body?.voice ? String(body.voice).toLowerCase() : "";
  const voiceDesc = getVoiceDescription(voiceId);
  // Hijab flag — accepts both "yes"/"no" (Auto Content shape) and
  // boolean. Defaults to false. Triggers HIJAB LOCK in the locks block
  // so Veo can't drop the tudung mid-generation.
  const rawHijab = body?.hijab ?? body?.avatar_hijab;
  const isHijab =
    rawHijab === true ||
    rawHijab === "yes" ||
    rawHijab === "hijab" ||
    rawHijab === 1;

  // Mode-aware required-input validation.
  //   - Prompt mode: needs body.prompt (the verbatim Veo prompt textarea)
  //   - Idea mode:   needs body.idea_scene; body.prompt is intentionally
  //                  empty because the backend expands idea_scene+idea_usp
  //                  into the full Veo prompt below
  // Previously this check ran on rawInput only — which is body.prompt —
  // so Idea mode submissions always errored "Prompt required" even with
  // a valid Scene Idea + USP filled in.
  if (inputMode === "idea") {
    const ideaSceneCheck = String(body?.idea_scene || "").trim();
    if (!ideaSceneCheck) {
      return NextResponse.json(
        { error: "Scene idea required" },
        { status: 400 }
      );
    }
  } else if (!rawInput) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  // ── IDEA MODE: 2-input expansion with rotated UGC framework ───────
  // Reads body.idea_scene (required) + body.idea_usp (optional) from
  // the new 2-field UI. Picks ONE random framework from the UGC pool
  // in lib/auto-content-frameworks.ts and asks Gemini 3.1 Flash Lite
  // to write the full Veo prompt:
  //   - Scene Idea → owns the VISUAL (what's happening in the frame)
  //   - USP Produk → seeded into the dialog so the script mentions the
  //     product's actual value (when present)
  //   - Framework  → owns the DIALOG SHAPE (PAS / AIDA / Testimonial /
  //     etc.) + emotion arc + CTA style. Random rotation per call so
  //     repeat clicks on the same scene idea produce different scripts.
  //
  // Mirrors Auto Content's Custom Idea pattern: idea owns visual,
  // framework owns dialog. Difference is UGC doesn't pre-pick the
  // framework — backend rotates randomly here so user doesn't have to
  // think about it. Falls back to verbatim if expansion errors.
  let rawPrompt = rawInput;
  let originalIdea = "";
  let pickedFrameworkName = "";
  if (inputMode === "idea") {
    const ideaScene = String(body?.idea_scene || rawInput || "").trim().slice(0, 400);
    const ideaUsp = String(body?.idea_usp || "").trim().slice(0, 300);
    originalIdea = ideaUsp
      ? `${ideaScene} · USP: ${ideaUsp}`
      : ideaScene;

    // Pick a random UGC-type framework from the Auto Content pool.
    // Filter to type='ugc' (10 frameworks) — exclude product/lifestyle
    // because UGC tab is always character-on-screen.
    const ugcFrameworks = FRAMEWORKS.filter((f) => f.type === "ugc");
    const fw = ugcFrameworks[Math.floor(Math.random() * ugcFrameworks.length)] || ugcFrameworks[0];
    pickedFrameworkName = fw?.name || "";

    try {
      // Image-mode aware context — Custom Idea must respect whichever
      // input mode the user picked: ingredient (avatar+product refs),
      // frame (i2v start/end frames), or text (pure t2v, no refs).
      // The Gemini system prompt branches on this so the expanded
      // Veo prompt matches the actual data being sent.
      let refContextHint = "";
      let refAnchorHint = "";
      if (imageMode === "ingredient") {
        // R2V — avatar (image_urls[0] when present) + 1-2 product refs.
        const hasAvatar = imageUrls.length > 0;
        const hasProduct = imageUrls.length > 1;
        refContextHint = hasAvatar && hasProduct
          ? "INGREDIENT MODE (R2V): character avatar attached as ref #1, product attached as ref #2. Both treated as scene ingredients — Veo composes a fresh scene featuring BOTH."
          : hasAvatar
            ? "INGREDIENT MODE (R2V): character avatar attached as reference. Product (if mentioned) is described in the prompt text only — no product image attached."
            : hasProduct
              ? "INGREDIENT MODE (R2V): product attached as reference. No avatar — character will be invented by Veo based on the scene description."
              : "INGREDIENT MODE but no images attached — falling back to t2v.";
        refAnchorHint = [
          hasAvatar ? 'Anchor the character: "Same person from reference image (same face, same outfit)."' : "",
          hasProduct ? 'Anchor the product: "Same product from reference image (same label, same packaging, no modification)."' : "",
        ].filter(Boolean).join("\n- ");
      } else if (imageMode === "frame") {
        // I2V — 1-2 images used as START FRAME and optional END FRAME.
        // Veo interpolates motion between them. Prompt must describe
        // the MOTION, not just the scene.
        const hasStart = imageUrls.length > 0;
        const hasEnd = imageUrls.length > 1;
        refContextHint = hasStart && hasEnd
          ? "FRAME MODE (I2V): two reference images — first is the video START FRAME, second is the END FRAME. Veo interpolates MOTION between them across 8 seconds."
          : hasStart
            ? "FRAME MODE (I2V): one reference image used as the video START FRAME. Veo generates 8s of motion forward from this frame."
            : "FRAME MODE but no start image attached — falling back to t2v.";
        refAnchorHint = hasStart
          ? 'Describe the MOTION that unfolds from the start frame (and toward the end frame if present): "Camera slowly pushes in", "Character lifts the product", "Slow pan reveals the setting", etc. Do NOT re-describe the static scene from the reference — describe what HAPPENS.'
          : "";
      } else {
        // T2V — pure text-to-video, no reference images.
        refContextHint = "TEXT MODE (T2V): NO reference images attached. Veo generates everything from your text. Describe the character (gender, age, outfit, expression), the product (color, shape, packaging if mentioned in USP), the setting, and the motion fully — Veo has no visual anchor.";
        refAnchorHint = "";
      }

      const frameworkBlock = fw
        ? `=== ROTATED UGC FRAMEWORK: ${fw.name} ===
Focus: ${fw.focus}
Shot direction: ${fw.shot1}
Emotion arc: ${fw.emotion}
Dialog shape: ${fw.strategy.dialogShape}
Example tone: ${fw.strategy.example}
CTA style: ${fw.ctaStyle}

Use this framework's dialog shape to structure the 20-24 word Malay dialog. The Scene Idea owns the visual (what's happening); the Framework owns the dialog beats (hook → middle → close).`
        : "";

      const uspBlock = ideaUsp
        ? `=== PRODUCT USP (weave into dialog where natural) ===
${ideaUsp}

Mention the USP organically in the middle beat of the dialog — don't list it like a feature dump.`
        : "=== NO USP PROVIDED — keep dialog scene-focused, don't invent product claims ===";

      const ideaSystem = `You expand a Malaysian TikTok creator's UGC scene idea + product USP into a full Veo 3.1 Fast video prompt, using a rotated dialog framework.

OUTPUT: plain text (NO markdown, NO JSON). One scene description paragraph followed by a "Spoken dialog:" block.

${frameworkBlock}

${uspBlock}

Hard rules:
- Total spoken dialog = EXACTLY 20-24 Malay words for an 8-second shot. Count the words. Under 18 = TTS mouth freezes. Over 26 = rushed audio.
- Bahasa Melayu (Malaysian Malay) ONLY. Use: korang, aku, ni, tu, memang, gila, lah, je, dah, eh. NEVER Bahasa Indonesia (kalian, gue, lo, banget, sih, dong, kayak, gimana, mau, nih, tuh).
${provider === "sora2" ? `
🚨🚨🚨 SORA 2 DIALOG MODERATION (NON-NEGOTIABLE — VIDEOS WITH BANNED CLAIMS LOSE AUDIO) 🚨🚨🚨

This video routes through Sora 2 (sora-2-vip). OpenAI's safety layer SILENTLY drops audio (keeps video) when dialog reads as an unverified medical / efficacy claim. We've reproduced this 4 times with the EXACT same locks — the only differentiator is dialog content. To make Sora 2 generate audio reliably, the dialog MUST avoid the BANNED CLAIM PATTERN and follow the REQUIRED FRAMING.

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

Why this rule applies HERE: this is a Sora 2 generation. If the dialog you write contains any banned vocabulary, the generated video will be SILENT (no audio). The user will see the mouth move but hear nothing. ALWAYS frame dialog as personal testimonial, never as clinical advertorial.
` : ""}

=== ACTION-RICH SCENE (NON-NEGOTIABLE) ===
Scene description = 150-220 words. The character MUST be performing a SPECIFIC ACTIVE VERB throughout the 8 seconds — never a static pose. Reject phrases like "gesturing to her stomach" / "holding product and smiling" / "standing while talking" — these are creative failures.

GOOD action verbs (use one matched to the scene idea + product):
  cooking · stirring · frying · pouring · blending · chopping · grilling
  vacuuming · cleaning · wiping · spraying · sprinkling · folding · dressing
  applying · massaging · brushing · smelling · tasting · sipping · slicing
  unboxing · demonstrating · pressing button · shaking bottle · tilting

For EACH scene, you MUST include all 6 layers:
  1) ACTION: specific verb the character is doing with the product (NOT just holding)
  2) CAMERA: movement style — "slow handheld cinematic", "smooth push-in", "medium shot dengan depth of field cetek", "close-up sinematik"
  3) SENSORY: at least 1 sensory detail relevant to the scene — steam rising, oil sizzling, fabric texture, liquid pouring smoothly, splash, reflection, blue gas flame, condensation, etc.
  4) BACKGROUND: specific room details — "dapur moden warna putih krim dengan kabinet kayu cerah", "ruang tamu dengan sofa warm beige", "vanity table dengan pampas grass". Avoid generic "in a kitchen" / "in a bedroom".
  5) LIGHTING: specific style — "warm tungsten lighting", "soft natural daylight", "warm under-cabinet glow", "golden hour ambient"
  6) AESTHETIC VIBE: 1-2 descriptors — "cozy luxury kitchen atmosphere", "premium TikTok ad vibe", "Scandinavian aesthetic", "cinematic food commercial style"

=== INPUT MODE CONTEXT ===
${refContextHint}
${refAnchorHint ? `- ${refAnchorHint}` : ""}

- Audio: spoken dialog only, no background music or SFX (system appends AUDIO LOCK that enforces this).
- Format: just the scene paragraph, then "Spoken dialog:" line, then the dialog itself. Nothing else.

Example output shape (ACTION-RICH — note the verbs, sensory details, camera movement, background richness):
Medium shot cinematic, slow handheld push-in, dengan depth of field cetek. Same person from reference image, sedang memasak telur goreng dalam wok stainless steel besar menggunakan sudip kayu, asap nipis naik perlahan dari telur yang sizzling dengan minyak panas. Background dapur moden warna putih krim, kabinet kayu cerah, pokok hijau kecil di tepi tingkap, warm tungsten lighting dari atas. Kamera bergerak slow dari side ke depan, ultra realistic skin texture, lived-in countertop dengan minor clutter (kain dapur, bawang merah dipotong). Cozy luxury kitchen atmosphere, premium TikTok cooking commercial style, smooth motion, realistic steam, natural blue flame visible at the corner.

Spoken dialog:
Korang tau tak ni apa? Aku baru jumpa, memang lain rasa dia! Try sekali, lepas tu kau cakap dengan aku. Beli sekarang!`;

      const userBlock = ideaUsp
        ? `Scene Idea: ${ideaScene}\nUSP Produk: ${ideaUsp}`
        : `Scene Idea: ${ideaScene}`;

      const ideaResult = await orChat({
        // Custom Idea expansion shares model_custom_idea with Auto
        // Content's master plan — both do the same "expand brief →
        // structured Veo prompt" job. Falls back to model_auto when
        // admin hasn't configured a dedicated model.
        modelKey: "model_custom_idea",
        systemPrompt: ideaSystem,
        userPrompt: userBlock,
        temperature: 0.8,
        maxTokens: 700,
      });
      if (ideaResult.ok && ideaResult.content) {
        rawPrompt = ideaResult.content.trim();
      } else if (ideaScene) {
        rawPrompt = ideaScene;
      }
    } catch (e) {
      // Expansion error → fall through using raw scene idea verbatim.
      // Better than blocking the generation.
      if (ideaScene) rawPrompt = ideaScene;
    }
  }

  // Append the canonical Veo lock block (same one used by UGC agent + Auto
  // Content). Voice character — STRICT pick from the 30-voice catalog:
  //   1. If user picked voice via the dropdown → use that voiceId
  //   2. Else → auto-detect persona (gender / age / vibe) from the
  //      prompt text via pickVoiceFromPrompt → resolve to a catalog voice
  // Either way buildVeoLocks emits a specific "VOICE CHARACTER (LOCKED):
  // <Name> — <traits>" line that Veo treats as a hard constraint.
  // Hijab toggles HIJAB LOCK + removes "loose hair" from UGC AUTHENTICITY.
  const autoPickedVoiceId = voiceId ? "" : pickVoiceFromPrompt(rawPrompt);
  const prompt =
    rawPrompt +
    buildVeoLocks({
      voiceId: voiceId || autoPickedVoiceId,
      hijab: isHijab,
    });

  // Billing reason — Sora 2 always bills under video_8s for now (admin
  // can refine later). Veo uses the canonical video_8s / video_16s split.
  const reason =
    provider === "sora2" ? "video_8s" : durationMode === "16" ? "video_16s" : "video_8s";
  const is16s = provider === "veo" && durationMode === "16";

  // Sora 2 cost: sora2_rate × duration (per-second pricing). Computed
  // here so the placeholder row carries the correct cost from the start.
  let sora2Cost = 0;
  if (provider === "sora2") {
    const { getSetting, getCinemaRate } = await import("@/lib/settings");
    const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
    const cinemaRate = await getCinemaRate();
    const ratePerSec =
      typeof sora2RateSetting?.rate === "number"
        ? sora2RateSetting.rate
        : cinemaRate * 2;
    sora2Cost = Number((ratePerSec * soraDuration).toFixed(4));
  }

  // Insert placeholder NOW. task_id + cost populated by after().
  // For 16s: this row IS seg-1 of a chained 16s clip. The settle hook
  // (lib/segment-chain.ts onSegmentSettled) reads metadata.duration_mode +
  // segment_index + seg2_prompt + frame_anchor to fire seg-2 + merge
  // automatically when seg-1 finishes. Manual UGC reuses the same prompt
  // for seg-2 since the user only typed one prompt body.
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "video",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] || null,
      task_id: null,
      duration: provider === "sora2" ? soraDuration : is16s ? 16 : 8,
      cost: provider === "sora2" ? sora2Cost : 0,
      segment_index: is16s ? 1 : null,
      frame_anchor: is16s ? "last" : null,
      metadata: {
        aspectRatio,
        imageMode,
        // Stamp Sora 2 routing on the metadata so admin/usage Detail
        // Log shows the right TAB chip (SORA 2 green) for these rows.
        ...(provider === "sora2"
          ? {
              modelChoice: "sora2",
              model: "sora-2-vip",
              sora2Provider: "apipod",
              resolution: aspectRatio === "9:16" ? "720x1280" : "1280x720",
            }
          : {}),
        // Full attachment array so Resubmit can re-fire with all 3
        // reference images, not just reference_url (which is only the
        // first). Crucial for r2v / ingredient mode product anchoring.
        image_urls: imageUrls,
        upload_status: "queued",
        // Stamp idea-mode origin when the user used the Idea expander
        // so admin/usage Detail Log can surface it under the Idea
        // column (matches Auto Content's idea_style convention).
        // Also stamp the rotated UGC framework name so admin can see
        // which framework drove this dialog (same Framework column the
        // Auto Content rows use — UGC Idea rows now populate it too).
        ...(inputMode === "idea" && originalIdea
          ? {
              idea_style: originalIdea.slice(0, 200),
              expanded_from_idea: true,
              ...(pickedFrameworkName ? { framework: pickedFrameworkName } : {}),
            }
          : {}),
        ...(is16s
          ? {
              duration_mode: "16s",
              // Reuse the same prompt body for seg-2 — same character + scene,
              // continuation handled by the frame-anchor reference image
              // extracted from seg-1's last frame.
              seg2_prompt: rawPrompt,
              hijab: isHijab,
              voice_line: voiceDesc || "",
            }
          : {}),
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const historyId = hist.id;

  after(async () => {
    try {
      // Sora 2 routing — bypass Veo's p2 model resolution and dispatch
      // through the sora2 cascade asset directly. p6.ts's
      // transformPromptForSora2() auto-rewrites inline 'Spoken dialog:'
      // into Sora 2's required Dialogue: block before sending to APIPod.
      if (provider === "sora2") {
        const rate = sora2Cost; // already computed above (sora2_rate × duration)
        const cascaded = await generateVideoWithCascade({
          primaryModel: "sora2", // p6.ts maps to sora-2-vip
          userId: user.id,
          prompt,
          // Sora 2 takes a single first-frame image only.
          imageUrls: imageUrls.slice(0, 1),
          imageMode: imageMode === "ingredient" ? "frame" : imageMode,
          aspectRatio,
          durationMode: String(soraDuration),
          asset: "sora2",
        });

        if (!cascaded.ok) {
          await admin.from("history").update({
            status: "failed",
            cost: rate,
            error_message: cascaded.error || "Sora 2 cascade exhausted",
            metadata: {
              aspectRatio, imageMode,
              modelChoice: "sora2",
              model: "sora-2-vip",
              sora2Provider: "apipod",
              tier_log: cascaded.tierLog,
              upload_status: "failed",
            },
          }).eq("id", historyId);
          return;
        }

        await admin.from("history").update({
          task_id: cascaded.taskId,
          cost: rate,
          metadata: {
            aspectRatio,
            imageMode,
            modelChoice: "sora2",
            model: cascaded.actualModel || "sora-2-vip",
            sora2Provider: "apipod",
            provider: cascaded.actualProvider,
            slot: cascaded.actualSlot,
            ...(cascaded.keyIndex !== undefined ? { p6_key_index: cascaded.keyIndex } : {}),
            fallback_used: cascaded.fallbackUsed,
            tier_log: cascaded.tierLog,
            resolution: aspectRatio === "9:16" ? "720x1280" : "1280x720",
            upload_status: "queued",
            featureType: "sora2",
            ...(inputMode === "idea" && originalIdea
              ? {
                  idea_style: originalIdea.slice(0, 200),
                  expanded_from_idea: true,
                  ...(pickedFrameworkName ? { framework: pickedFrameworkName } : {}),
                }
              : {}),
          },
        }).eq("id", historyId);
        return;
      }

      // ─────────────── Veo path (default) ───────────────
      const [cfg, rate] = await Promise.all([
        getP2Config(),
        priceFor(user.id, reason as any),
      ]);
      const model =
        imageMode === "text"
          ? cfg.videoT2V
          : imageMode === "ingredient"
            ? cfg.videoR2V
            : cfg.videoI2V;
      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost: rate,
          error_message: "P2 video model missing",
          metadata: { aspectRatio, imageMode, upload_status: "failed" },
        }).eq("id", historyId);
        return;
      }

      // For 16s clips fire Veo at 8s only — seg-2 + merge are handled
      // by lib/segment-chain.ts onSegmentSettled when this row settles.
      // Cascade: p2 → p1 → p3, plus product-ref triplicate at the top.
      const result = await generateVideoWithCascade({
        primaryModel: model,
        userId: user.id,
        prompt,
        imageUrls,
        durationMode: is16s ? "8" : durationMode,
        aspectRatio,
        imageMode,
      });

      if (!result.ok) {
        await admin.from("history").update({
          status: "failed",
          cost: rate,
          error_message: result.error,
          metadata: {
            aspectRatio, imageMode, model,
            tier_log: result.tierLog,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: result.taskId,
        cost: rate,
        metadata: {
          aspectRatio,
          imageMode,
          model: result.actualModel,
          provider: result.actualProvider,
          slot: result.actualSlot,
          // p6 (APIPod) multi-key — settle.ts needs this to poll
          // with the same key that submitted the task.
          ...(result.keyIndex !== undefined ? { p6_key_index: result.keyIndex } : {}),
          fallback_used: result.fallbackUsed,
          tier_log: result.tierLog,
          upload_status: "done",
          ...(is16s
            ? {
                duration_mode: "16s",
                seg2_prompt: rawPrompt,
                hijab: isHijab,
                voice_line: voiceDesc || "",
              }
            : {}),
        },
      }).eq("id", historyId);
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed",
        error_message: e?.message || "Background error",
        metadata: { aspectRatio, imageMode, upload_status: "failed" },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
  });
}
