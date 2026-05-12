import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { p3CreateImage } from "@/lib/p3";
import { getP2Config, getSetting } from "@/lib/settings";
import { priceFor } from "@/lib/deduct";

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
        getSetting<{ provider: "p2" | "p3" }>("storytelling_provider"),
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
        "z-image": "z-image",
        "gpt-image-2": "openai/gpt-image-2-stable",
      };
      const modelKey = ftModelSetting?.model || cfg.imageDefault || "nano-banana-pro";
      const rate = typeof ftRateSetting?.rate === "number" ? ftRateSetting.rate : defaultRate;
      // storytelling_provider toggle — default p2 (Crun) for backward
      // compat, p3 (Mountsea) when admin opts in. Mountsea-specific
      // model mapping: strips Crun's "google/" prefix so its API
      // accepts the bare nano-banana-pro / nano-banana-2 keys.
      const provider: "p2" | "p3" =
        ftProviderSetting?.provider === "p3" ? "p3" : "p2";

      let createdOk = false;
      let createdTaskId: string | null = null;
      let createdError: string | null = null;
      let usedFallback = false;
      // Track which provider actually produced the row so settle.ts knows
      // which upstream to query when the task lands. Default = the user's
      // chosen provider; flipped to "p2" if we fall back from p3 → p2.
      let actualProvider: "p2" | "p3" = provider;

      // Detect content-moderation rejections from Mountsea (Google nano-
      // banana proxy). HTTP 451 = "unavailable for legal reasons" — that's
      // Google's safety filter. The same prompt will fail on retry; only
      // a different MODEL (with a different filter) can save it.
      const isMountseaBlocked = (err: string | null | undefined): boolean => {
        if (!err) return false;
        return /451|content.*polic|moderation|safety|blocked|unsafe|harmful/i.test(err);
      };

      if (provider === "p3") {
        // Mountsea path — locked to nano-banana-fast per product
        // requirements (cheapest tier, fast turnaround for batch
        // storytelling). Resolution stays at 2K which is what fast
        // accepts. Auto-retry up to 3 attempts before giving up so
        // transient Mountsea blips don't kill the whole story.
        const MAX_TRIES = 3;
        let lastError: string | null = null;
        let hitContentBlock = false;
        for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
          const r = await p3CreateImage({
            prompt,
            model: "nano-banana-fast",
            aspectRatio,
          });
          if (r.ok && r.task_id) {
            createdOk = true;
            createdTaskId = r.task_id;
            lastError = null;
            break;
          }
          lastError = r.ok ? "no task_id" : r.error;
          // Content-moderation block → don't waste retries with the same
          // prompt, jump straight to Crun fallback.
          if (isMountseaBlocked(lastError)) {
            hitContentBlock = true;
            console.warn(
              `[fairytale-scene] Mountsea content-block on attempt ${attempt}: ${lastError}`
            );
            break;
          }
          if (attempt < MAX_TRIES) {
            console.warn(
              `[fairytale-scene] Mountsea attempt ${attempt}/${MAX_TRIES} failed: ${lastError}`
            );
            await new Promise((res) => setTimeout(res, 1500 * attempt));
          }
        }
        createdError = lastError;

        // Fallback to Crun (p2) with nano-banana-v2 when Mountsea fails
        // for ANY reason after the retry loop. nano-banana-v2 has a
        // different (lighter) safety filter than Mountsea's Google
        // direct proxy, so prompts blocked at p3 often pass through p2.
        if (!createdOk) {
          console.warn(
            `[fairytale-scene] Mountsea exhausted (${hitContentBlock ? "content-blocked" : "no task_id"}: ${createdError}), falling back to Crun nano-banana-v2`
          );
          const fallback = await p2CreateTask({
            model: "google/nano-banana-v2",
            prompt,
            aspectRatio,
          });
          if (fallback.ok && fallback.task_id) {
            createdOk = true;
            createdTaskId = fallback.task_id;
            createdError = null;
            usedFallback = true;
            actualProvider = "p2";
          } else {
            createdError = `Mountsea: ${createdError}; Crun fallback: ${fallback.ok ? "no task_id" : fallback.error}`;
          }
        }
      } else {
        // p2 / Crun path (existing behaviour)
        const modelId =
          (cfg.imageModels as any)?.[modelKey] ||
          HARDCODED_MODEL_IDS[modelKey] ||
          modelKey;
        let created = await p2CreateTask({
          model: modelId,
          prompt,
          aspectRatio,
        });
        // Fallback: if Crun rejects with model-not-found, retry once with
        // google/nano-banana-v2 (known-stable balanced model).
        const looksLikeBadModel =
          !created.ok &&
          modelId !== "google/nano-banana-v2" &&
          /model|not.found|invalid|unknown|bad request|param/i.test(String(created.error || ""));
        if (looksLikeBadModel) {
          usedFallback = true;
          console.warn(
            `[fairytale-scene] model "${modelId}" rejected (${created.error}), retrying with google/nano-banana-v2`
          );
          created = await p2CreateTask({
            model: "google/nano-banana-v2",
            prompt,
            aspectRatio,
          });
        }
        createdOk = created.ok;
        // p2CreateTask's success branch guarantees task_id is string, but
        // TS can't narrow a non-discriminated union — so coalesce.
        createdTaskId = created.ok ? (created.task_id ?? null) : null;
        createdError = created.ok ? null : (created.error ?? null);
      }

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
            // actualProvider reflects the upstream that actually accepted
            // the task — falls back to p2/nano-banana-v2 when p3 was
            // content-blocked. settle.ts reads metadata.provider to pick
            // the right status-polling endpoint.
            provider: actualProvider,
            model: actualProvider === "p3" ? "nano-banana-fast" : "google/nano-banana-v2",
            fallback_used: usedFallback,
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
