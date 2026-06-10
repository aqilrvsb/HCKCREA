import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { buildVeoLocks, getVoiceDescription } from "@/lib/veo-voices";
import { generateVideoWithCascade } from "@/lib/video-cascade";

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
  // UGC tab is DIALOG-ONLY: the client writes just the spoken line; the
  // full scene/visual prompt is built deterministically below from the
  // image mode + which references were uploaded (no AI expansion).
  // `body.dialog` is the field; `body.prompt` is kept as a fallback for
  // older clients / resubmits that still send a full prompt verbatim.
  const dialog = String(body?.dialog ?? body?.prompt ?? "").trim();
  // True when an avatar reference was uploaded in ingredient mode — the
  // frontend flags it so the template anchors person (image #1) vs
  // product (image #2) consistency correctly.
  const hasAvatar = body?.has_avatar === true;
  // Character gender (Dialog UGC toggle). Drives the gendered subject in
  // the scene prompt AND the voice pick (so the audio matches the person).
  // Defaults to female — the most common Malay UGC seller persona.
  const gender: "male" | "female" = body?.gender === "male" ? "male" : "female";
  // Provider routing — Veo (default) / Sora 2 / Grok Imagine 1.5. Each
  // non-Veo provider routes through its own cascade asset + per-second
  // pricing. Grok + Sora 2 both build the SAME dialog scene prompt (so
  // the Dialog UGC UI is identical) — only the dispatch asset differs.
  // p6.ts auto-transforms the inline 'Spoken dialog:' format into Sora 2's
  // required Dialogue: block; Grok reads the inline format directly.
  const provider: "veo" | "sora2" | "grok" =
    body?.provider === "sora2" ? "sora2" : body?.provider === "grok" ? "grok" : "veo";
  // Grok runs a fixed 8s clip here to match the Veo UI (no duration picker).
  const grokDuration = 8;
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

  // Dialog is the only required text input now. A reference image is
  // required for every mode except the t2v fallback.
  if (!dialog) {
    return NextResponse.json({ error: "Dialog required" }, { status: 400 });
  }
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  // ── DIALOG → SCENE PROMPT (deterministic, no AI) ──────────────────
  // Short, clear, gender-neutral scene template. The client owns the
  // dialog; we own the visual + consistency rules. Branches on image
  // mode + uploaded refs so frame / product / avatar / both all stay
  // consistent. Kept concise on purpose so every model (Veo / Sora 2)
  // parses it cleanly. For Sora 2, p6.transformPromptForSora2 rewrites
  // the quoted `Spoken dialog: "..."` line into a Dialogue: block.
  const rawPrompt = buildUgcScenePrompt({ imageMode, imageUrls, hasAvatar, dialog, gender });

  // Append the canonical Veo lock block (same one used by UGC agent + Auto
  // Content). Voice character — STRICT pick from the 30-voice catalog:
  //   1. If user picked voice via the dropdown → use that voiceId
  //   2. Else → auto-detect persona (gender / age / vibe) from the
  //      prompt text via pickVoiceFromPrompt → resolve to a catalog voice
  // Either way buildVeoLocks emits a specific "VOICE CHARACTER (LOCKED):
  // <Name> — <traits>" line that Veo treats as a hard constraint.
  // Hijab toggles HIJAB LOCK + removes "loose hair" from UGC AUTHENTICITY.
  // Voice: an explicit dropdown pick wins; otherwise the gender toggle
  // drives a gender-matched catalog voice (default age 30s) so the audio
  // matches the on-screen person. buildVeoLocks resolves gender+age via
  // pickVoiceByPersona.
  const prompt =
    rawPrompt +
    buildVeoLocks({
      voiceId: voiceId || undefined,
      gender,
      age: "30s",
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

  // Grok cost: grok_rate × duration (per-second pricing, like Sora 2).
  let grokCost = 0;
  if (provider === "grok") {
    const { getGrokRate } = await import("@/lib/settings");
    const grokRate = await getGrokRate();
    grokCost = Number((grokRate * grokDuration).toFixed(4));
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
      duration:
        provider === "sora2" ? soraDuration : provider === "grok" ? grokDuration : is16s ? 16 : 8,
      cost: provider === "sora2" ? sora2Cost : provider === "grok" ? grokCost : 0,
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
        // Stamp Grok routing so admin/usage shows the right chip.
        ...(provider === "grok"
          ? {
              modelChoice: "grok",
              model: "grok-imagine",
              resolution: "720p",
            }
          : {}),
        // Full attachment array so Resubmit can re-fire with all 3
        // reference images, not just reference_url (which is only the
        // first). Crucial for r2v / ingredient mode product anchoring.
        image_urls: imageUrls,
        upload_status: "queued",
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
          },
        }).eq("id", historyId);
        return;
      }

      // ─────────────── Grok Imagine 1.5 path ───────────────
      // Same dialog scene prompt as Veo (locks included) — only the
      // dispatch differs: routes through the GROK cascade asset (p2-a/b
      // Grok slots). UGC always has an image, so grok-imagine i2v.
      if (provider === "grok") {
        const cfgGrok = await getP2Config();
        const grokModel =
          imageMode === "text" ? cfgGrok.grokT2V : cfgGrok.grokI2V;
        if (!grokModel) {
          await admin.from("history").update({
            status: "failed",
            cost: grokCost,
            error_message: "Grok model missing (p2 config)",
            metadata: {
              aspectRatio, imageMode,
              modelChoice: "grok",
              model: "grok-imagine",
              resolution: "720p",
              upload_status: "failed",
            },
          }).eq("id", historyId);
          return;
        }
        const cascaded = await generateVideoWithCascade({
          primaryModel: grokModel,
          userId: user.id,
          prompt,
          imageUrls,
          imageMode: imageMode === "ingredient" ? "frame" : imageMode,
          aspectRatio,
          durationMode: String(grokDuration),
          asset: "grok",
        });

        if (!cascaded.ok) {
          await admin.from("history").update({
            status: "failed",
            cost: grokCost,
            error_message: cascaded.error || "Grok cascade exhausted",
            metadata: {
              aspectRatio, imageMode,
              modelChoice: "grok",
              model: "grok-imagine",
              resolution: "720p",
              tier_log: cascaded.tierLog,
              upload_status: "failed",
            },
          }).eq("id", historyId);
          return;
        }

        await admin.from("history").update({
          task_id: cascaded.taskId,
          cost: grokCost,
          metadata: {
            aspectRatio,
            imageMode,
            modelChoice: "grok",
            model: cascaded.actualModel || "grok-imagine",
            provider: cascaded.actualProvider,
            slot: cascaded.actualSlot,
            ...(cascaded.keyIndex !== undefined ? { p6_key_index: cascaded.keyIndex } : {}),
            fallback_used: cascaded.fallbackUsed,
            tier_log: cascaded.tierLog,
            resolution: "720p",
            upload_status: "queued",
            featureType: "grok",
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

// Build the full UGC scene prompt from the client's dialog + the uploaded
// references. Deliberately short and GENDER-NEUTRAL — the uploaded image
// (frame / avatar) defines the person, so we never hard-code gender or
// outfit; we only enforce consistency with whatever was uploaded. The
// dialog is wrapped in quotes on a single `Spoken dialog: "..."` line so
// (a) Veo reads it inline and (b) p6.transformPromptForSora2 can rewrite
// it into Sora 2's required Dialogue: block.
function buildUgcScenePrompt(opts: {
  imageMode: "frame" | "ingredient" | "text";
  imageUrls: string[];
  hasAvatar: boolean;
  dialog: string;
  gender: "male" | "female";
}): string {
  // Strip quote chars: the Sora 2 transform delimits the dialog on quotes,
  // so a stray quote inside would truncate the captured line.
  const dialog = opts.dialog.replace(/["'‘’“”]/g, "").trim();
  const dialogBlock = `Spoken dialog: "${dialog}"`;
  // Gendered subject so the visual + voice match the toggle.
  const subject = opts.gender === "male" ? "man" : "woman";
  const speak =
    "speaks naturally in Malay with realistic lip sync. Warm, friendly, confident, trustworthy expression, natural hand gestures, subtle body movement, realistic blinking and breathing";
  // Look + quality directive — NO camera-movement instruction (per user
  // direction). Lighting + commercial look + render-quality only,
  // de-duplicated into one concise line.
  const look =
    "Soft professional studio lighting, clean background, shallow depth of field, ultra realistic skin texture, highly detailed fabric folds, realistic shadows. Premium product commercial, natural motion, realistic lip sync, 720p, cinematic quality.";
  const mood =
    "Dialogue mood: enthusiastic, friendly seller, authentic social-media presentation.";

  let scene: string;
  if (opts.imageMode === "frame") {
    const hasEnd = opts.imageUrls.length > 1;
    // Dynamic version of the reference consistency prompt — no hard-coded
    // outfit/product. The uploaded image already has the character
    // holding/presenting the product; we lock BOTH from the source image.
    scene =
      "Use the uploaded image as the primary character and visual reference. Maintain the EXACT same character, face, outfit, colours, patterns, fabric texture, accessories AND the exact same product from the source image — identical clothing and product design. No outfit, colour, pattern, accessory, or product changes anywhere." +
      (hasEnd
        ? " Begin on the first image and transition naturally toward the second image."
        : "") +
      `\n\nThe ${subject} stays in the same setting, looks directly into the camera, and ${speak}.`;
  } else if (opts.imageMode === "ingredient") {
    const hasProduct = opts.hasAvatar
      ? opts.imageUrls.length > 1
      : opts.imageUrls.length > 0;
    if (opts.hasAvatar && hasProduct) {
      scene =
        "Use the first reference image as the character and the second reference image as the product. Keep the exact same face, outfit and appearance of the person, and the exact same product — same label, shape, colours and packaging, with no modification." +
        `\n\nThe ${subject} holds and presents the product, looks directly into the camera, and ${speak}.`;
    } else if (opts.hasAvatar) {
      scene =
        "Use the reference image as the character. Keep the exact same face, outfit, colours and appearance from the source image — no changes." +
        `\n\nThe ${subject} looks directly into the camera and ${speak}.`;
    } else {
      scene =
        "Use the reference image as the product. Keep the exact same product — same label, shape, colours and packaging, with no modification." +
        `\n\nA Malaysian ${subject} holds and presents this product, looks directly into the camera, and ${speak}.`;
    }
  } else {
    // text-to-video — no reference image (fallback only; UI no longer offers it)
    scene = `A Malaysian ${subject} looks directly into the camera and ${speak}. Simple clean indoor setting.`;
  }

  return `${scene}\n\n${look}\n\n${mood}\n\n${dialogBlock}`;
}
