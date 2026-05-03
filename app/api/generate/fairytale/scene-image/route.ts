import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
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
      const [cfg, rate] = await Promise.all([
        getP2Config(),
        priceFor(user.id, "image_generate"),
      ]);
      const modelKey = cfg.imageDefault || "nano-banana-pro";
      const modelId = (cfg.imageModels as any)?.[modelKey] || modelKey;

      const created = await p2CreateTask({
        model: modelId,
        prompt,
        aspectRatio,
      });

      if (!created.ok || !created.task_id) {
        await admin
          .from("history")
          .update({
            status: "failed",
            cost: rate,
            error_message: created.error || "P2 create failed",
            metadata: {
              aspectRatio,
              scene_idx: sceneIdx,
              group_id: fairytaleGroupId,
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }

      await admin
        .from("history")
        .update({
          task_id: created.task_id,
          cost: rate,
          metadata: {
            model: modelKey,
            aspectRatio,
            scene_idx: sceneIdx,
            group_id: fairytaleGroupId,
            provider: created.provider || "p2",
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
