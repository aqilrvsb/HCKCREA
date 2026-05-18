import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config, getSetting } from "@/lib/settings";
import { priceFor } from "@/lib/deduct";
import { generateImageWithCascade } from "@/lib/image-cascade";

// POST /api/generate/fairytale/scene-image
//
// Generate ONE scene image from a prompt. Reuses the same image pipeline as
// /api/generate/image (P2/P1 dispatch via p2CreateTask), but tags the row
// with type='fairytale-scene' so the wizard can fetch only its own scene
// images via /api/history?type=fairytale-scene.
//
// Pattern A (placeholder + after()) — returns history_id in ~150ms,
// background work fires the actual generation. Frontend polls /api/history
// to detect status='done' + output_url filled.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim().slice(0, 1500);
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const projectId = body?.project_id ? String(body.project_id) : null;
  const sceneIdx = Number.isInteger(body?.scene_idx) ? Number(body.scene_idx) : null;
  const fairytaleGroupId = body?.group_id ? String(body.group_id) : null;

  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const admin = createAdminClient();

  // Insert placeholder. type='fairytale-scene' lets the wizard filter to just
  // its own scenes in history. Group ID lets the wizard correlate scenes
  // back to the same generation batch.
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "fairytale-scene",
      tab: "fairytale",
      status: "pending",
      prompt,
      task_id: null,
      cost: 0,
      metadata: {
        aspectRatio,
        scene_idx: sceneIdx,
        group_id: fairytaleGroupId,
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
      // Per-fairytale image model + rate overrides via admin settings:
      //   fairytale_image_model: { model: "z-image" }  (any Crun model id)
      //   fairytale_image_rate:  { rate: 0.05 }        (RM per image)
      // Both fall back to the global imageDefault + image_generate rate
      // when not set, so existing installs keep working unchanged.
      const [cfg, defaultRate, ftModelSetting, ftRateSetting, ftProviderSetting] = await Promise.all([
        getP2Config(),
        priceFor(user.id, "image_generate"),
        getSetting<{ model: string }>("fairytale_image_model"),
        getSetting<{ rate: number }>("fairytale_image_rate"),
        getSetting<{ provider: "p2" | "p3" | "p4" }>("storytelling_provider"),
      ]);
      // Resolve admin's model key to the actual upstream API model id.
      // The image_models mapping seeded in migration 0001 covers
      // nano-banana-pro / nano-banana-2 / gpt-image-2, but the newer
      // nano-banana-v2 (Crun's "google/nano-banana-v2") may not be in
      // the mapping yet. Hardcode that one + leave the rest to the
      // mapping fall-through.
      const HARDCODED_MODEL_IDS: Record<string, string> = {
        "nano-banana-v2": "google/nano-banana-v2",
        "nano-banana-pro": "google/nano-banana-pro",
        "nano-banana-2": "google/nano-banana-2",
        "nano-banana-fast": "google/nano-banana",
        "z-image": "z-image",
        "gpt-image-2": "openai/gpt-image-2-stable",
      };
      // STORYTELLING FOCUS: lock to a nano-banana variant. Admin can
      // pick which variant via fairytale_image_model (defaults to
      // nano-banana-pro). Anything else (z-image, gpt-image-2) gets
      // coerced to nano-banana-pro so every cascade slot can serve
      // the same model family — important now that we walk all
      // main → fallback slots on failure (a slot that doesn't
      // support the requested model wastes a tier).
      const adminModel = ftModelSetting?.model || cfg.imageDefault || "nano-banana-pro";
      const modelKey = adminModel.toLowerCase().includes("nano-banana")
        ? adminModel
        : "nano-banana-pro";
      const rate = typeof ftRateSetting?.rate === "number" ? ftRateSetting.rate : defaultRate;
      // storytelling_provider toggle — default p2 (Crun) for backward
      // compat, p3 (Mountsea) when admin opts in. Mountsea-specific
      // model mapping: strips Crun's "google/" prefix so its API
      // accepts the bare nano-banana-pro / nano-banana-2 keys.
      const provider: "p2" | "p3" | "p4" =
        ftProviderSetting?.provider === "p2"
          ? "p2"
          : ftProviderSetting?.provider === "p3"
            ? "p3"
            : "p4";

      // FULL CASCADE for storytelling scene-image. Walks every main
      // slot in round-robin order, then every fallback slot, until
      // one CREATE succeeds. Unlike auto-content (single-shot —
      // failures handled by user clicking Resubmit) the Storytelling
      // merge breaks if ANY scene image is missing, so it's worth
      // burning a few slots to land each image.
      //
      // Locked to nano-banana family above so every tier serves the
      // same model — no "this slot doesn't support gpt-image-2" dead
      // tiers wasting time.
      const primaryModelForP2 =
        (cfg.imageModels as any)?.[modelKey] ||
        HARDCODED_MODEL_IDS[modelKey] ||
        modelKey;
      const cascadeResult = await generateImageWithCascade({
        primaryProvider: provider,
        primaryModel: modelKey,
        primaryModelP2: primaryModelForP2,
        prompt,
        aspectRatio,
        fullCascade: true,
      });
      const createdOk = cascadeResult.ok;
      const createdTaskId = cascadeResult.ok ? cascadeResult.taskId : null;
      const createdError = cascadeResult.ok ? null : cascadeResult.error;
      const usedFallback = cascadeResult.ok ? cascadeResult.fallbackUsed : false;
      const actualProvider: "p1" | "p2" | "p3" | "p4" | "p5" =
        cascadeResult.ok ? cascadeResult.actualProvider : provider;
      const actualModel = cascadeResult.ok ? cascadeResult.actualModel : "";
      const tierLog = cascadeResult.tierLog;

      if (!createdOk || !createdTaskId) {
        await admin
          .from("history")
          .update({
            status: "failed",
            cost: rate,
            error_message:
              (createdError || `${provider.toUpperCase()} create failed`) +
              (usedFallback ? " (fallback nano-banana-v2 also failed)" : ""),
            metadata: {
              aspectRatio,
              scene_idx: sceneIdx,
              group_id: fairytaleGroupId,
              upload_status: "failed",
              provider,
            },
          })
          .eq("id", historyId);
        return;
      }

      await admin
        .from("history")
        .update({
          task_id: createdTaskId,
          cost: rate,
          metadata: {
            // actualProvider + actualModel reflect the tier that actually
            // accepted the task. settle.ts reads metadata.provider to pick
            // the right status-polling endpoint. tier_log records the
            // outcome of each cascade step so admin can audit which tier
            // is saving most scenes.
            provider: actualProvider,
            slot: cascadeResult.ok ? cascadeResult.actualSlot : undefined,
            model: actualModel,
            primary_provider: provider,
            fallback_used: usedFallback,
            tier_log: tierLog,
            aspectRatio,
            scene_idx: sceneIdx,
            group_id: fairytaleGroupId,
            upload_status: "done",
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId, scene_idx: sceneIdx });
}
