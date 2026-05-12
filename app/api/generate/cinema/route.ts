import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getCinemaRate, getP2Config } from "@/lib/settings";

// POST /api/generate/cinema — Viral tab. Two model options:
//   • model="grok"  → grok-imagine/t2v or /i2v, 6-30s, per-second pricing
//   • model="veo"   → google/veo3-1-fast t2v / r2v, fixed 8s, flat-ish pricing
//
// Both image modes are supported on both models:
//   • text  → no img_urls
//   • image → single img_urls
//
// Resolution 720p, mode "normal". Price = duration * cinema_rate_per_sec.
// (For Veo, duration is forced to 8 so price = 8 × rate.)
//
// IMPORTANT: prompt is sent to the provider 100% verbatim. No locks, no
// templates, no character/anatomy injection at this layer. Whatever the
// user types in the textarea is what reaches the model.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim().substring(0, 5000);
  const imageUrl = body?.image_url ? String(body.image_url) : "";
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const resolution = body?.resolution === "480p" ? "480p" : "720p";
  const modelChoice: "grok" | "veo" = body?.model === "veo" ? "veo" : "grok";
  // Veo is fixed 8s. Grok ranges 6-30s. Defaults to 6 for Grok.
  const duration = modelChoice === "veo"
    ? 8
    : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
  const imageMode = body?.image_mode === "image" ? "image" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode === "image" && !imageUrl) {
    return NextResponse.json(
      { error: "Reference image required for Image-to-Video mode" },
      { status: 400 }
    );
  }

  // Insert placeholder NOW. Cost + task_id populated by after().
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "cinema",
      status: "pending",
      prompt,
      reference_url: imageUrl || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode === "image" ? null : aspectRatio,
        cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
        modelChoice,
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
      const [cfg, ratePerSec] = await Promise.all([
        getP2Config(),
        getCinemaRate(),
      ]);
      const cost = Number((ratePerSec * duration).toFixed(4));

      // Pick the actual provider model id based on (modelChoice, imageMode).
      // Grok and Veo each have separate t2v / i2v (or r2v) endpoints.
      let model: string | undefined;
      if (modelChoice === "veo") {
        model = imageMode === "image" ? cfg.videoR2V : cfg.videoT2V;
      } else {
        model = imageMode === "image" ? cfg.grokI2V : cfg.grokT2V;
      }

      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: `Viral model not configured (${modelChoice}/${imageMode})`,
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode === "image" ? null : aspectRatio,
            cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
            modelChoice,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      // Veo flows through the 3-tier cascade (p2 → p1 → p3); Grok stays
      // on p2 only (no Grok fallback path defined).
      const imgs = imageMode === "image" && imageUrl ? [imageUrl] : [];
      const imgMode: "frame" | "ingredient" | "text" =
        imageMode === "image" ? "ingredient" : "text";

      let createdOk = false;
      let createdTaskId: string | null = null;
      let createdError: string | null = null;
      let actualProvider = "p2";
      let actualModel = model;
      let fallbackUsed = false;
      let tierLog: any = undefined;

      if (modelChoice === "veo") {
        const result = await generateVideoWithCascade({
          primaryModel: model,
          prompt,
          imageUrls: imgs,
          durationMode: String(duration),
          aspectRatio,
          imageMode: imgMode,
        });
        if (result.ok) {
          createdOk = true;
          createdTaskId = result.taskId;
          actualProvider = result.actualProvider;
          actualModel = result.actualModel;
          fallbackUsed = result.fallbackUsed;
        } else {
          createdError = result.error;
        }
        tierLog = result.tierLog;
      } else {
        // Grok path — single shot on p2.
        const created = await p2CreateTask({
          model,
          prompt,
          imageUrls: imgs,
          durationMode: String(duration),
          aspectRatio,
          resolution,
          extra: { mode: "normal" },
        });
        if (created.ok && created.task_id) {
          createdOk = true;
          createdTaskId = created.task_id;
          actualProvider = created.provider || "p2";
        } else {
          createdError = created.error || "Grok create failed";
        }
      }

      if (!createdOk) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: createdError || "Viral create failed",
          metadata: {
            model, imageMode, resolution,
            aspectRatio: imageMode === "image" ? null : aspectRatio,
            cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
            modelChoice,
            provider: actualProvider,
            tier_log: tierLog,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: createdTaskId,
        cost,
        metadata: {
          model: actualModel, imageMode, resolution,
          aspectRatio: imageMode === "image" ? null : aspectRatio,
          cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
          modelChoice,
          provider: actualProvider,
          fallback_used: fallbackUsed,
          tier_log: tierLog,
          upload_status: "done",
        },
      }).eq("id", historyId);
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed",
        error_message: e?.message || "Background error",
        metadata: {
          imageMode, resolution,
          aspectRatio: imageMode === "image" ? null : aspectRatio,
          cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
          modelChoice,
          upload_status: "failed",
        },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    duration,
    model: modelChoice,
  });
}
