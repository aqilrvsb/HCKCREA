import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getCinemaRate, getP2Config, getSetting } from "@/lib/settings";

// POST /api/generate/cinema — Original Video tab + legacy Viral. Three
// provider options:
//   • model="grok"   → grok-imagine/t2v or /i2v, 6-30s, per-second pricing
//   • model="veo"    → google/veo3-1-fast t2v / r2v, fixed 8s
//   • model="sora2"  → openai/sora-2-vip, 8s or 12s, per-second pricing
//
// Image modes:
//   • text  → no img_urls
//   • image → 1 (Sora 2) or 1-3 (Veo r2v) or 1-7 (Grok i2v) img_urls
//
// Pricing: Grok + Veo = duration × cinema_rate_per_sec, Sora 2 = duration ×
// sora2_rate (admin setting, falls back to cinema_rate × 2).
//
// IMPORTANT: prompt is sent to the provider 100% verbatim. No locks, no
// templates, no character/anatomy injection at this layer. Whatever the
// user types in the textarea is what reaches the model — including for
// Sora 2 (the auto-Dialogue:-block transform in p6.ts is SUPPRESSED for
// this route via rawPrompt=true so power-user prompts stay untouched).
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
  const modelChoice: "grok" | "veo" | "sora2" =
    body?.model === "veo"
      ? "veo"
      : body?.model === "sora2"
        ? "sora2"
        : "grok";
  // Per-provider duration constraints:
  //   • Veo    → fixed 8s (model only emits 8s natively)
  //   • Sora 2 → 8 or 12 (APIPod's sora-2-vip enum)
  //   • Grok   → 6-30 (slider, per-second billing)
  const duration =
    modelChoice === "veo"
      ? 8
      : modelChoice === "sora2"
        ? body?.duration === 12 || body?.duration === "12"
          ? 12
          : 8
        : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
  // Three image modes (richer than the old image/text split):
  //   • "text"       → no reference images
  //   • "frame"      → single first-frame image (i2v, all 3 providers)
  //   • "ingredient" → multi-ref (r2v, Veo only — Grok/Sora 2 clamped to frame)
  // Legacy "image" string maps to "frame" for backwards-compat.
  let imageModeRaw: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame" || body?.image_mode === "image"
        ? "frame"
        : "text";
  // Clamp ingredient → frame for Grok/Sora 2 (they don't support r2v).
  if (imageModeRaw === "ingredient" && modelChoice !== "veo") {
    imageModeRaw = "frame";
  }
  const imageMode = imageModeRaw;
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
  if (imageMode !== "text" && effectiveImageUrls.length === 0) {
    return NextResponse.json(
      { error: "Reference image required for this image mode" },
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
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo"
            ? "veo"
            : modelChoice === "sora2"
              ? "apipod"
              : "grok-imagine",
        modelChoice,
        featureType,
        // Full attachment array for Resubmit re-fire
        image_urls: effectiveImageUrls,
        upload_status: "queued",
        // Sora 2 routing — let history grid + admin chip detection pick
        // up the SORA 2 tag (matches existing detection patterns).
        ...(modelChoice === "sora2"
          ? {
              model: "sora-2-vip",
              sora2Provider: "apipod",
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
      const [cfg, cinemaRatePerSec] = await Promise.all([
        getP2Config(),
        getCinemaRate(),
      ]);
      // Sora 2 has its own per-second rate setting. Falls back to cinema
      // rate × 2 when admin hasn't configured it. Grok + Veo share the
      // cinema rate (Veo billed flat as 8 × cinemaRate).
      let ratePerSec = cinemaRatePerSec;
      if (modelChoice === "sora2") {
        const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
        ratePerSec =
          typeof sora2RateSetting?.rate === "number"
            ? sora2RateSetting.rate
            : cinemaRatePerSec * 2;
      }
      const cost = Number((ratePerSec * duration).toFixed(4));

      // Pick the actual provider model id based on (modelChoice, imageMode).
      // Each provider has its own t2v / i2v (or r2v) endpoints:
      //   • Veo    → text/frame/ingredient → t2v / fast / fast-ref
      //   • Grok   → text or frame → grok-imagine t2v / i2v
      //   • Sora 2 → text or frame → sora-2-vip (single endpoint,
      //     p6.ts handles t2v vs i2v by presence of image_url)
      let model: string | undefined;
      if (modelChoice === "veo") {
        model = imageMode === "ingredient"
          ? cfg.videoR2V
          : imageMode === "frame"
            ? cfg.videoI2V
            : cfg.videoT2V;
      } else if (modelChoice === "sora2") {
        model = "sora2"; // p6.ts apipodVideoModel maps to "sora-2-vip"
      } else {
        model = imageMode !== "text" ? cfg.grokI2V : cfg.grokT2V;
      }

      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: `Viral model not configured (${modelChoice}/${imageMode})`,
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo"
                ? "veo"
                : modelChoice === "sora2"
                  ? "apipod"
                  : "grok-imagine",
            modelChoice,
            featureType,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      // Image mode passes through verbatim now — the route exposes
      // "text" / "frame" / "ingredient" directly to the cascade. p6.ts
      // and other provider adapters use this to pick the right
      // endpoint variant (t2v / i2v / r2v).
      const imgMode: "frame" | "ingredient" | "text" = imageMode;
      // Per-provider image cap (frontend UX-aligned, may be tighter
      // than the API's max):
      //   • Sora 2 → 1 first frame only (API-mandated)
      //   • Veo r2v / i2v → up to 3
      //   • Grok i2v → up to 3 (UX cap; APIPod supports 1-7)
      const imgs =
        imageMode === "text"
          ? []
          : modelChoice === "sora2"
            ? effectiveImageUrls.slice(0, 1)
            : effectiveImageUrls.slice(0, 3);

      let createdOk = false;
      let createdTaskId: string | null = null;
      let createdError: string | null = null;
      let actualProvider = "p2";
      let actualSlot: string | undefined = undefined;
      let actualKeyIndex: number | undefined = undefined;
      let actualModel = model;
      let fallbackUsed = false;
      let tierLog: any = undefined;

      // Per-asset cascade routing:
      //   • modelChoice='grok'  → GROK cascade pool
      //   • modelChoice='veo'   → VIDEO cascade pool
      //   • modelChoice='sora2' → SORA2 cascade pool (APIPod p6 slots)
      // Admin configures each pool independently in /admin/settings →
      // Cascade. Original Video tab + Auto Content Grok + UGC tab all
      // share the same per-asset pools so a slot rotation in admin
      // updates every consumer at once.
      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        asset:
          modelChoice === "grok"
            ? "grok"
            : modelChoice === "sora2"
              ? "sora2"
              : "video",
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
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo"
                ? "veo"
                : modelChoice === "sora2"
                  ? "apipod"
                  : "grok-imagine",
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
          aspectRatio: imageMode !== "text" ? null : aspectRatio,
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : "grok-imagine",
          modelChoice,
          featureType,
          provider: actualProvider,
          slot: actualSlot,
          ...(actualKeyIndex !== undefined ? { p6_key_index: actualKeyIndex } : {}),
          fallback_used: fallbackUsed,
          tier_log: tierLog,
          upload_status: "done",
          // Stamp Sora 2 routing on success metadata so admin chip
          // detection + history grid show the right tag for these rows.
          ...(modelChoice === "sora2"
            ? {
                sora2Provider: "apipod",
              }
            : {}),
        },
      }).eq("id", historyId);
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed",
        error_message: e?.message || "Background error",
        metadata: {
          imageMode, resolution,
          aspectRatio: imageMode !== "text" ? null : aspectRatio,
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : "grok-imagine",
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
