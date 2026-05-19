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
  const imageUrls: string[] = Array.isArray(body?.image_urls) ? body.image_urls : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const durationMode: "8" | "16" = body?.duration === "16" ? "16" : "8";
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
- Scene description: shot type (e.g. "Selfie-style handheld" or "Medium shot"), what the character is doing, setting, lighting, mood. Keep it CONCISE — 80-150 words max.

=== INPUT MODE CONTEXT ===
${refContextHint}
${refAnchorHint ? `- ${refAnchorHint}` : ""}

- Audio: spoken dialog only, no background music or SFX (system appends AUDIO LOCK that enforces this).
- Format: just the scene paragraph, then "Spoken dialog:" line, then the dialog itself. Nothing else.

Example output shape:
Selfie-style handheld shot, arm's length. Same person from reference image, holding the same product from the second reference image. Bright natural daylight, kitchen setting, smiling naturally while showing the product to camera.

Spoken dialog:
Korang tau tak ni apa? Aku baru jumpa, memang lain rasa dia! Try sekali, lepas tu kau cakap dengan aku. Beli sekarang!`;

      const userBlock = ideaUsp
        ? `Scene Idea: ${ideaScene}\nUSP Produk: ${ideaUsp}`
        : `Scene Idea: ${ideaScene}`;

      const ideaResult = await orChat({
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

  const reason = durationMode === "16" ? "video_16s" : "video_8s";
  const is16s = durationMode === "16";

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
      duration: is16s ? 16 : 8,
      cost: 0,
      segment_index: is16s ? 1 : null,
      frame_anchor: is16s ? "last" : null,
      metadata: {
        aspectRatio,
        imageMode,
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
