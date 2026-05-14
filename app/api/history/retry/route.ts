import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { generateVideoWithCascade } from "@/lib/video-cascade";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/history/retry { history_id }
//
// Re-fires the SAME row that previously failed. Updates status pending +
// new task_id in place — no new history row, no double-charge. Works for
// every generation tab (image / video / ugc / cinema / auto-content) by
// reading the original row's prompt + reference_url + metadata and picking
// the right Crun.ai model from app_settings.
//
// Auth model: user must own the row. We re-use whatever was stored on the
// row (prompt, reference_url, metadata.model, imageMode, duration) so the
// retry is byte-identical to the first attempt.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error: selErr } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, prompt, reference_url, duration, cost, metadata"
    )
    .eq("id", historyId)
    .maybeSingle();

  if (selErr || !row) {
    return NextResponse.json({ error: "History row not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.prompt) {
    return NextResponse.json(
      { error: "Original prompt missing — cannot retry" },
      { status: 400 }
    );
  }

  // Block retry on rows that are still in flight or already done. Only
  // failed rows make sense to retry; the user can stop pending rows by
  // letting them settle / fail naturally first.
  if (row.status !== "failed") {
    return NextResponse.json(
      {
        error: `Row is "${row.status}" — only failed rows can be retried`,
      },
      { status: 400 }
    );
  }

  const cfg = await getP2Config();
  const meta = (row.metadata || {}) as Record<string, any>;
  const refImage = row.reference_url || "";
  const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
  const durationMode: "8" | "16" = row.duration === 16 ? "16" : "8";
  const imageMode: "frame" | "ingredient" | "text" =
    meta.imageMode === "frame" || meta.imageMode === "ingredient"
      ? meta.imageMode
      : refImage
        ? "ingredient"
        : "text";

  // Pick the right Crun.ai model based on the tab the row originally ran
  // through. metadata.model wins if it's been recorded (auto-content rows
  // record the resolved model so retry is exact-faithful even if admin
  // rotated the model since the original fire).
  let model = String(meta.model || "");
  if (!model) {
    if (row.tab === "image" || row.type === "image") {
      const imgModel =
        meta.image_model ||
        meta.model_override ||
        cfg.imageDefault ||
        "google/nano-banana-pro";
      model = String(imgModel);
    } else if (row.tab === "cinema") {
      // Cinema r2v if reference, t2v otherwise
      model = refImage ? cfg.grokI2V : cfg.grokT2V;
    } else {
      // video / ugc / auto-content / clone
      model = refImage ? cfg.videoR2V : cfg.videoT2V;
    }
  }

  // Route through the appropriate cascade:
  //   • image / fairytale-scene → image cascade (p2/p3 → p1 → other)
  //   • cinema with Grok        → p2 only (no Grok cascade defined)
  //   • else (video tabs)       → video cascade (p2 → p1 → p3)
  const isImageRow =
    row.tab === "image" || row.type === "image" || row.type === "fairytale-scene";
  const isGrok = model.toLowerCase().includes("grok");

  let newTaskId: string | null = null;
  let newProvider: "p1" | "p2" | "p3" = "p2";
  let newModel: string = model;
  let fallbackUsed = false;
  let tierLog: any = undefined;
  let retryError: string | null = null;

  if (isImageRow) {
    const primaryProvider: "p2" | "p3" =
      meta.primary_provider === "p3" || meta.provider === "p3" ? "p3" : "p2";
    const r = await generateImageWithCascade({
      primaryProvider,
      primaryModel: model.replace(/^google\//, "").replace(/^openai\//, ""),
      primaryModelP2: model,
      prompt: row.prompt,
      aspectRatio,
      imageUrls: refImage ? [refImage] : undefined,
    });
    if (r.ok) {
      newTaskId = r.taskId;
      newProvider = r.actualProvider;
      newModel = r.actualModel;
      fallbackUsed = r.fallbackUsed;
      tierLog = r.tierLog;
    } else {
      retryError = r.error;
      tierLog = r.tierLog;
    }
  } else if (isGrok) {
    const created = await p2CreateTask({
      model,
      userId: user.id,
      prompt: row.prompt,
      imageUrls: refImage ? [refImage] : [],
      durationMode,
      aspectRatio,
      imageMode,
    });
    if (created.ok && created.task_id) {
      newTaskId = created.task_id;
      newProvider = (created.provider || "p2") as "p1" | "p2" | "p3";
    } else {
      retryError = created.error || "Grok create failed";
    }
  } else {
    // Skip tiers that previously accepted the task but failed downstream
    // during polling. Without this, retrying a Crun-poll-failed row just
    // re-fires the same broken tier and loops. tier_log uses 1-indexed
    // strings like "1:p2:..." / "2:p2:..." / "3:p1:..." / "4:p3:..." so
    // we parse the leading digit and bump past the highest OK tier.
    const priorLog: Array<{ tier?: string; ok?: boolean }> = Array.isArray(
      meta.tier_log
    )
      ? meta.tier_log
      : [];
    let startTier: 1 | 2 | 3 | 4 = 1;
    for (const entry of priorLog) {
      if (!entry?.ok) continue;
      const n = parseInt(String(entry.tier || "").split(":")[0], 10);
      if (n >= startTier && n < 4) startTier = (n + 1) as 1 | 2 | 3 | 4;
    }
    if (startTier > 1) {
      console.warn(
        `[retry] row ${row.id} previously OK at tier <${startTier} but failed downstream — starting cascade at tier ${startTier}`
      );
    }

    const r = await generateVideoWithCascade({
      primaryModel: model,
      userId: user.id,
      prompt: row.prompt,
      imageUrls: refImage ? [refImage] : [],
      durationMode,
      aspectRatio,
      imageMode,
      startTier,
    });
    if (r.ok) {
      newTaskId = r.taskId;
      newProvider = r.actualProvider;
      newModel = r.actualModel;
      fallbackUsed = r.fallbackUsed;
      tierLog = r.tierLog;
    } else {
      retryError = r.error;
      tierLog = r.tierLog;
    }
  }

  if (!newTaskId) {
    // All cascade tiers failed (or Grok create failed). Stamp the latest
    // error onto the row so the user sees why retry didn't take.
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: retryError || "Retry failed",
        metadata: {
          ...meta,
          last_retry_error: retryError || "Retry failed",
          last_retry_at: new Date().toISOString(),
          tier_log: tierLog,
        },
      })
      .eq("id", row.id);

    return NextResponse.json(
      { error: retryError || "Retry failed" },
      { status: 502 }
    );
  }

  // Flip the row back to pending with the new task_id so the existing
  // settle / poll path (webhook + cron) picks up the result on the SAME
  // card. Wipe error_message so the failure UI clears immediately.
  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: newTaskId,
      error_message: null,
      metadata: {
        ...meta,
        provider: newProvider,
        model: newModel,
        fallback_used: fallbackUsed,
        tier_log: tierLog,
        retried_at: new Date().toISOString(),
        retry_count: Number(meta.retry_count || 0) + 1,
        last_retry_error: null,
      },
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    history_id: row.id,
    task_id: newTaskId,
  });
}
