import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // Multi-ref input (new). When the user picks 1 → triplicated below.
  // When 2-3 picked → sent as distinct refs to Veo r2v.
  const rawImageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x)
    : [];
  const effectiveImageUrls =
    rawImageUrls.length > 0
      ? rawImageUrls
      : imageUrl
        ? [imageUrl]
        : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const resolution = body?.resolution === "480p" ? "480p" : "720p";
  const modelChoice: "grok" | "veo" = body?.model === "veo" ? "veo" : "grok";
  // Veo is fixed 8s. Grok ranges 6-30s. Defaults to 6 for Grok.
  const duration = modelChoice === "veo"
    ? 8
    : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
  const imageMode = body?.image_mode === "image" ? "image" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;
  // Feature tag — set to "grok" when the new dedicated Grok tab submits
  // this. History grid uses metadata.featureType to route the row to the
  // right tab. Legacy callers (Cinema → Normal Video) don't send this,
  // so we infer "normal-video" so those rows still surface on the old
  // Cinema sub-tab. The Talking Object route stamps its own values
  // ("talking-object" / "talking-object-image") in a separate handler.
  const featureType =
    body?.feature === "grok" ? "grok" : "normal-video";

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode === "image" && effectiveImageUrls.length === 0) {
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
      reference_url: effectiveImageUrls[0] || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode === "image" ? null : aspectRatio,
        cinemaProvider: modelChoice === "veo" ? "veo" : "grok-imagine",
        modelChoice,
        featureType,
        // Full attachment array for Resubmit re-fire
        image_urls: effectiveImageUrls,
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
            featureType,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      // Veo flows through the 3-tier cascade (p2 → p1 → p3); Grok stays
      // on p2 only (no Grok fallback path defined). Apply the triplicate
      // rule: 1 picked → [u,u,u]; 2-3 → distinct refs as-is.
      const imgs =
        imageMode === "image"
          ? effectiveImageUrls.length === 1
            ? [effectiveImageUrls[0], effectiveImageUrls[0], effectiveImageUrls[0]]
            : effectiveImageUrls.slice(0, 3)
          : [];
      const imgMode: "frame" | "ingredient" | "text" =
        imageMode === "image" ? "ingredient" : "text";

      let createdOk = false;
      let createdTaskId: string | null = null;
      let createdError: string | null = null;
      let actualProvider = "p2";
      let actualSlot: string | undefined = undefined;
      let actualKeyIndex: number | undefined = undefined;
      let actualModel = model;
      let fallbackUsed = false;
      let tierLog: any = undefined;

      // Both Veo and Grok now route through the round-robin cascade —
      // Veo lands on p2-a/b / p5 / p1 (whichever main slot), Grok can
      // land on p6-a..h (APIPod) which is the only Grok-capable slot
      // configured in main/fallback. p6CreateVideo's apipodVideoModel
      // detects 'grok' in the model string and switches to
      // grok-imagine-t2v / grok-imagine-i2v accordingly.
      //
      // Grok i2v takes 1-7 image_urls; Veo r2v takes 1-3 (triplicated
      // when user picks just 1). Pass the raw effective images and let
      // the slot's CreateVideo decide the per-model cap.
      const cascadeImgs =
        modelChoice === "grok"
          ? imageMode === "image" && effectiveImageUrls[0]
            ? effectiveImageUrls.slice(0, 7)
            : []
          : imgs;
      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: cascadeImgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        // Grok routes through the Grok cascade (typically p6-a..h);
        // Veo stays on the Video cascade. Each has its own admin-tuned
        // main+fallback pool + independent round-robin counter.
        asset: modelChoice === "grok" ? "grok" : "video",
      });
      if (result.ok) {
        createdOk = true;
        createdTaskId = result.taskId;
        actualProvider = result.actualProvider;
        actualSlot = result.actualSlot;
        actualKeyIndex = result.keyIndex;
        actualModel = result.actualModel;
        fallbackUsed = result.fallbackUsed;
      } else {
        createdError = result.error;
      }
      tierLog = result.tierLog;

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
            featureType,
            provider: actualProvider,
          slot: actualSlot,
          ...(actualKeyIndex !== undefined ? { p6_key_index: actualKeyIndex } : {}),
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
          featureType,
          provider: actualProvider,
          slot: actualSlot,
          ...(actualKeyIndex !== undefined ? { p6_key_index: actualKeyIndex } : {}),
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
          featureType,
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
