import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { buildVeoLocks, getVoiceDescription, pickVoiceFromPrompt } from "@/lib/veo-voices";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { orChat } from "@/lib/openrouter";

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

  if (!rawInput) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  // ── IDEA MODE: expand one-liner into a full Veo prompt ────────────
  // Gemini 3.1 Flash Lite reads the user's idea + the attachment context
  // (avatar / product hint) and writes a complete scene description
  // with embedded 20-24 Malay-word spoken dialog. No framework layer
  // (UGC isn't framework-based); dialog is enforced by the canonical
  // DIALOG LENGTH LOCK appended downstream anyway, so we ask Gemini
  // for loose-structure dialog (just total word count, no beat budget).
  //
  // Falls back to verbatim if expansion errors — user still gets a
  // generation, just from their raw idea text instead of the expanded
  // version. Better than blocking the click.
  let rawPrompt = rawInput;
  let originalIdea = "";
  if (inputMode === "idea") {
    originalIdea = rawInput;
    try {
      const hasAvatar = imageUrls.length > 0 && imageMode === "ingredient";
      const hasProduct = imageUrls.length > 1 && imageMode === "ingredient";
      const refContextHint = hasAvatar && hasProduct
        ? "The user has attached a character avatar AND a product reference image."
        : hasAvatar
          ? "The user has attached a character avatar reference image."
          : hasProduct
            ? "The user has attached a product reference image."
            : "No reference images attached — describe the scene/character fully.";
      const ideaSystem = `You expand a Malaysian TikTok creator's short idea into a full Veo 3.1 Fast video prompt.

OUTPUT: plain text (NO markdown, NO JSON). One scene description paragraph followed by a "Spoken dialog:" block.

Hard rules:
- Total spoken dialog = 20-24 Malay words for an 8-second shot. Count the words. Under 18 = TTS mouth freezes. Over 26 = rushed audio.
- Bahasa Melayu (Malaysian Malay) ONLY. Use: korang, aku, ni, tu, memang, gila, lah, je, dah, eh. NEVER Bahasa Indonesia (kalian, gue, lo, banget, sih, dong, kayak, gimana, mau, nih, tuh).
- Natural pacing — don't force a hook/middle/CTA beat budget. Write what flows from the idea.
- Scene description: shot type (e.g. "Selfie-style handheld" or "Medium shot"), what the person/character is doing, setting, lighting, mood. Keep it CONCISE — 80-150 words max.
- ${refContextHint}
- ${hasAvatar ? 'Anchor the character to the reference: "Same person from reference image (same face, same outfit)."' : ""}
- ${hasProduct ? 'Anchor the product to the reference: "Same product from reference image (same label, same packaging)."' : ""}
- Audio: spoken dialog only, no background music or SFX (system appends AUDIO LOCK that enforces this).
- Format: just the scene paragraph, then "Spoken dialog:" line, then the dialog itself. Nothing else.

Example output shape:
Selfie-style handheld shot, arm's length. Same person from reference image, holding the same product from the second reference image. Bright natural daylight, kitchen setting, smiling naturally while showing the product to camera.

Spoken dialog:
Korang tau tak ni apa? Aku baru jumpa, memang lain rasa dia! Try sekali, lepas tu kau cakap dengan aku. Beli sekarang!`;
      const ideaResult = await orChat({
        systemPrompt: ideaSystem,
        userPrompt: `Idea: ${rawInput}`,
        temperature: 0.8,
        maxTokens: 600,
      });
      if (ideaResult.ok && ideaResult.content) {
        rawPrompt = ideaResult.content.trim();
      }
    } catch (e) {
      // Expansion error → fall through using raw input. The user's
      // idea text still goes to Veo, just unexpanded. Better than
      // blocking the generation.
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
        ...(inputMode === "idea" && originalIdea
          ? { idea_style: originalIdea.slice(0, 200), expanded_from_idea: true }
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
