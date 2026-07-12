import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getCinemaRate, getGeminiRate, getP2Config, getSeedanceRate, getSetting, getVeoRate } from "@/lib/settings";

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
  // Gemini fixes resolution at 1080p; other providers honour the request
  // body (or default to 720p). Sora 2 / Veo / Grok still go through their
  // existing 720/480p validation.
  const modelChoice: "grok" | "veo" | "sora2" | "gemini" | "seedance" =
    body?.model === "veo"
      ? "veo"
      : body?.model === "sora2"
        ? "sora2"
        : body?.model === "gemini"
          ? "gemini"
          : body?.model === "seedance"
            ? "seedance"
            : "grok";
  const resolution =
    modelChoice === "gemini"
      ? "1080p"
      : body?.resolution === "480p"
        ? "480p"
        : "720p";
  // Per-provider duration constraints:
  //   • Veo      → fixed 8s (model only emits 8s natively)
  //   • Sora 2   → 8 or 12 (APIPod's sora-2-vip enum)
  //   • Gemini   → fixed 10s (Original Video tab UX choice; API accepts
  //               4|6|8|10 but the chip only exposes 10)
  //   • Seedance → 4-15 (Seedance 2.0 Fast spec; slider)
  //   • Grok     → 1-15 (Grok Imagine 1.5 Preview spec; slider, per-second
  //               billing). Was 6-30 (legacy grok) which floored a client's
  //               3s pick up to 6s — fixed 2026-06-19 so the slider is honoured.
  const duration =
    modelChoice === "veo"
      ? 8
      : modelChoice === "sora2"
        ? body?.duration === 12 || body?.duration === "12"
          ? 12
          : 8
        : modelChoice === "gemini"
          ? 10
          : modelChoice === "seedance"
            ? Math.min(15, Math.max(4, Math.round(Number(body?.duration || 5))))
            : Math.min(15, Math.max(1, Math.round(Number(body?.duration || 6))));
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
  // Gemini is the inverse: it only has img_urls (no first-frame concept),
  // so "frame" → "ingredient" with a single image. The cinema route still
  // sends "ingredient" so video-cascade + p2 see the canonical mode.
  // Seedance supports all 3 modes natively (t2v/i2v/r2v) so no clamp.
  if (
    imageModeRaw === "ingredient" &&
    modelChoice !== "veo" &&
    modelChoice !== "gemini" &&
    modelChoice !== "seedance"
  ) {
    imageModeRaw = "frame";
  }
  // (Gemini frame→ingredient clamp REMOVED 2026-07-06 — APIPod's
  // gemini-omni-i2v is a real first-frame endpoint (1-2 image_urls =
  // first + optional last frame), so Original Video now exposes Start
  // Frame for Omni. Crun/p2 passes the same image_urls unchanged.)
  // Grok Imagine 1.5 has NO working text-to-video — the model REQUIRES a
  // start-frame image (provider rejects t2v with "grok-imagine-1.5-preview
  // requires a reference image"). Force frame mode so the image-required
  // guard below rejects an image-less Grok submission BEFORE it creates a
  // billable row / hits the provider. Fixed 2026-06-30.
  if (modelChoice === "grok") {
    imageModeRaw = "frame";
  }
  const imageMode = imageModeRaw;
  // GeminiOmni "Video Reference" mode — video-only (no images). The UI
  // sends image_mode="video" + video_url; both providers support it
  // (P2 Crun video_list, P6 APIPod gemini-omni-extend). Only meaningful
  // for gemini; ignored otherwise.
  const videoRefUrl =
    modelChoice === "gemini" && body?.image_mode === "video"
      ? String(body?.video_url || "").trim()
      : "";
  const isVideoRef = !!videoRefUrl;
  const projectId = body?.project_id ? String(body.project_id) : null;
  // Feature tag — distinguishes which tab submitted this row:
  //   • feature='original-video' → Original Video tab (3-provider raw)
  //   • feature='grok'           → dedicated Grok tab (hidden but route
  //                                still wired for back-compat)
  //   • else (no feature)        → legacy Viral / Cinema → Normal Video
  // featureType drives admin chip detection + history grid filtering.
  const featureType =
    body?.feature === "original-video"
      ? "original-video"
      : body?.feature === "grok"
        ? "grok"
        : "normal-video";

  // Tab tag — Original Video gets its own tab='original-video' so the
  // history grid + admin chip + cron asset detection can scope to just
  // this tab. Legacy Viral / Grok rows keep tab='cinema' so existing
  // history is unaffected.
  const tabTag: "cinema" | "original-video" =
    featureType === "original-video" ? "original-video" : "cinema";

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  // Video Reference mode requires the video (and needs no image).
  if (modelChoice === "gemini" && body?.image_mode === "video" && !videoRefUrl) {
    return NextResponse.json(
      { error: "Video reference required — upload a reference video first." },
      { status: 400 }
    );
  }
  // Guarantee the stored reference video fits APIPod's 8MB cap up front, so
  // every downstream path (render, cascade fallback, resubmit, cron) reuses
  // a source that's already small enough — no per-path compression needed.
  // Uploaded files are pre-shrunk in the browser (<8MB), so this only trips
  // on an oversized PASTED URL, which the browser can't touch. Fail fast
  // with a clear message instead of a cryptic ~16-min render failure.
  if (isVideoRef) {
    try {
      const head = await fetch(videoRefUrl, { method: "HEAD" });
      const bytes = Number(head.headers.get("content-length") || 0);
      if (bytes > 8 * 1024 * 1024) {
        return NextResponse.json(
          {
            error: `Video rujukan terlalu besar (${(bytes / 1024 / 1024).toFixed(1)}MB, maks 8MB). Muat naik fail video yang lebih pendek — kami auto-kecilkan bila anda upload.`,
          },
          { status: 400 }
        );
      }
    } catch {
      // HEAD unreachable (host blocks it / no content-length) — let it
      // through; the render still validates size upstream.
    }
  }
  if (!isVideoRef && imageMode !== "text" && effectiveImageUrls.length === 0) {
    return NextResponse.json(
      {
        error:
          modelChoice === "grok"
            ? "Grok 1.5 needs a start-frame image — upload a reference image first."
            : "Reference image required for this image mode",
      },
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
      tab: tabTag,
      status: "pending",
      prompt,
      reference_url: effectiveImageUrls[0] || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        imageMode: isVideoRef ? "video" : imageMode,
        ...(isVideoRef ? { videoRef: videoRefUrl } : {}),
        resolution,
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo"
            ? "veo"
            : modelChoice === "sora2"
              ? "apipod"
              : modelChoice === "gemini"
                ? "crun"
                : modelChoice === "seedance"
                  ? "bytedance"
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
        // Gemini routing — stamp the canonical model id so retry/settle
        // pick it back up via meta.model when modelChoice is unset on
        // legacy rows. cinemaProvider="crun" already disambiguates.
        ...(modelChoice === "gemini"
          ? {
              model: "google/gemini-omni",
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
      // Per-provider pricing — each provider reads its own admin
      // setting. No more shared rate / cinema-rate fallback noise:
      //   • Veo    → rate_veo.per_video_8s (flat per-video price)
      //   • Sora 2 → sora2_rate × duration (per-second, falls back
      //               to cinema rate × 2 if admin hasn't set sora2_rate)
      //   • Grok   → cinema rate × duration (per-second)
      // Each provider's price preview on the frontend reads from a
      // matching /api endpoint so what user sees = what they pay.
      let cost: number;
      if (modelChoice === "veo") {
        const veoFlat = await getVeoRate("8");
        cost = Number(veoFlat.toFixed(4));
      } else if (modelChoice === "sora2") {
        const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
        const ratePerSec =
          typeof sora2RateSetting?.rate === "number"
            ? sora2RateSetting.rate
            : cinemaRatePerSec * 2;
        cost = Number((ratePerSec * duration).toFixed(4));
      } else if (modelChoice === "gemini") {
        // GeminiOmni — flat per-video rate, duration is fixed 10s
        // server-side so we don't multiply.
        const geminiFlat = await getGeminiRate("10");
        cost = Number(geminiFlat.toFixed(4));
      } else if (modelChoice === "seedance") {
        // Seedance 2.0 Fast — per-second rate × duration (4-15s range).
        const seedanceRate = await getSeedanceRate();
        cost = Number((seedanceRate * duration).toFixed(4));
      } else {
        // Grok per-second
        cost = Number((cinemaRatePerSec * duration).toFixed(4));
      }

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
      } else if (modelChoice === "gemini") {
        // GeminiOmni — single Crun model id regardless of imageMode
        // (text + ingredient both go to the same endpoint; p2.ts handles
        // the conditional img_urls payload).
        model = "google/gemini-omni";
      } else if (modelChoice === "seedance") {
        // Seedance 2.0 Fast — pass the bare "seedance" keyword. Both
        // adapters auto-resolve to the right variant based on refs:
        //   • lib/p2.ts isSeedance branch  → bytedance/seedance2-0-fast-{t2v,r2v}
        //   • lib/p6.ts apipodVideoModel   → seedance-2.0-fast-{t2v,i2v,r2v}
        // No per-mode resolution here — the substring "seedance" is what
        // both adapters key off.
        model = "seedance";
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
                  : modelChoice === "gemini"
                    ? "crun"
                    : modelChoice === "seedance"
                      ? "bytedance"
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
        // Video Reference: product images ride ALONGSIDE the source video
        // (both providers accept up to 5 reference images) so the output
        // replicates the reference video but featuring the user's product.
        isVideoRef
          ? effectiveImageUrls.slice(0, 5)
          : imageMode === "text"
            ? []
            : modelChoice === "sora2"
              ? effectiveImageUrls.slice(0, 1)
              : modelChoice === "seedance"
                ? effectiveImageUrls.slice(0, 5)
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
        // GeminiOmni Video Reference → both providers (P2 video_list /
        // P6 gemini-omni-extend). Product images (imgs) ride along as
        // reference images so the output uses the user's product.
        refVideoUrl: videoRefUrl || undefined,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        asset:
          modelChoice === "grok"
            ? "grok"
            : modelChoice === "sora2"
              ? "sora2"
              : modelChoice === "gemini"
                ? "gemini"
                : modelChoice === "seedance"
                  ? "cinema"
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
            model,
            imageMode: isVideoRef ? "video" : imageMode,
            ...(isVideoRef ? { videoRef: videoRefUrl } : {}),
            resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo"
                ? "veo"
                : modelChoice === "sora2"
                  ? "apipod"
                  : modelChoice === "gemini"
                    ? "crun"
                    : modelChoice === "seedance"
                      ? "bytedance"
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
          model: actualModel,
          imageMode: isVideoRef ? "video" : imageMode,
          ...(isVideoRef ? { videoRef: videoRefUrl } : {}),
          resolution,
          aspectRatio: imageMode !== "text" ? null : aspectRatio,
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : modelChoice === "gemini"
                  ? "crun"
                  : modelChoice === "seedance"
                    ? "bytedance"
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
                : modelChoice === "gemini"
                  ? "crun"
                  : modelChoice === "seedance"
                    ? "bytedance"
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
