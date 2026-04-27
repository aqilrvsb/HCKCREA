import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";

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

  // Fire P2 again with the same params
  const created = await p2CreateTask({
    model,
    prompt: row.prompt,
    imageUrls: refImage ? [refImage] : [],
    durationMode,
    aspectRatio,
    imageMode,
  });

  if (!created.ok || !created.task_id) {
    // Keep the row failed but stamp the latest error so the user sees
    // why retry didn't take.
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: created.error || "Retry: P2 create failed",
        metadata: {
          ...meta,
          last_retry_error: created.error || "P2 create failed",
          last_retry_at: new Date().toISOString(),
        },
      })
      .eq("id", row.id);

    return NextResponse.json(
      { error: created.error || "P2 create failed" },
      { status: 502 }
    );
  }

  // Flip the row back to pending with the new task_id so the existing
  // settle / poll path (webhook + cron) picks up the result on the
  // SAME card. Wipe error_message so the failure UI clears immediately.
  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: created.task_id,
      error_message: null,
      metadata: {
        ...meta,
        retried_at: new Date().toISOString(),
        retry_count: Number(meta.retry_count || 0) + 1,
        last_retry_error: null,
      },
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    history_id: row.id,
    task_id: created.task_id,
  });
}
