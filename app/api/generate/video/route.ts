import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { buildVeoLocks, getVoiceDescription } from "@/lib/veo-voices";

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

  if (!rawPrompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  // Append the canonical Veo lock block (same one used by UGC agent + Auto
  // Content). Voice character — when picked — embeds into the AUDIO LOCK
  // so the model uses the exact same voice across the clip and any
  // future Extend continuation.
  const prompt =
    rawPrompt + buildVeoLocks({ voiceId, voiceLine: voiceDesc || undefined });

  const reason = durationMode === "16" ? "video_16s" : "video_8s";

  // Insert placeholder NOW. task_id + cost populated by after().
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
      duration: durationMode === "16" ? 16 : 8,
      cost: 0,
      metadata: {
        aspectRatio,
        imageMode,
        upload_status: "queued",
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

      const created = await p2CreateTask({
        model,
        userId: user.id,
        prompt,
        imageUrls,
        durationMode,
        aspectRatio,
        imageMode,
      });

      const provider = created.provider || "p2";
      if (!created.ok || !created.task_id) {
        await admin.from("history").update({
          status: "failed",
          cost: rate,
          error_message: created.error || "P2 create failed",
          metadata: { aspectRatio, imageMode, model, provider, upload_status: "failed" },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: created.task_id,
        cost: rate,
        metadata: { aspectRatio, imageMode, model, provider, upload_status: "done" },
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
