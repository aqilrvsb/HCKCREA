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
  const rawPrompt = String(body?.prompt || "").trim();
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

  if (!rawPrompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  // Append the canonical Veo lock block (same one used by UGC agent + Auto
  // Content). Voice character — when picked — embeds into the AUDIO LOCK
  // so the model uses the exact same voice across the clip and any
  // future Extend continuation. Hijab toggles the HIJAB LOCK + removes
  // "loose hair" from UGC AUTHENTICITY.
  const prompt =
    rawPrompt +
    buildVeoLocks({ voiceId, voiceLine: voiceDesc || undefined, hijab: isHijab });

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
