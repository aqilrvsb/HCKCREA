import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config } from "@/lib/settings";
import { p2CreateTask } from "@/lib/p2";
import { pollRefineTask } from "@/lib/refine-frame";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// POST /api/extend/recover-seg2 { history_id }
//
// Self-heal for stuck extend seg-2 rows. The /api/extend/video flow runs
// inside an after() background hook that does:
//   1. resolve start frame
//   2. Nano Banana Pro refine (cascade p2 → p1 → p3, up to 180s)
//   3. p2CreateTask for Veo seg-2
//   4. stamp task_id on the row
//
// When Vercel kills after() between step 2 and step 3 (e.g. cumulative
// slow refine + Veo create exceeds the function's maxDuration), the
// refined frame URL is already saved to metadata.anchor_frame_refined_url
// BUT no task_id is stamped and the row sits in "pending" forever.
//
// This endpoint detects that state and re-fires step 3 + 4 only — using
// the refined frame that was already paid for. Idempotent: skips if a
// task_id is already present so spam-clicks don't double-create.
//
// Applies to both UGC extend ("video" tab) and Auto Content extend
// ("auto" tab) — they share the same backend pipeline.

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, prompt, reference_url, duration, task_id, segment_index, parent_history_id, metadata"
    )
    .eq("id", historyId)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (row.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Guardrail 1 — must be a seg-2 child (segment_index=2, has parent).
  if (row.segment_index !== 2 || !row.parent_history_id) {
    return NextResponse.json(
      { error: "Recovery only applies to seg-2 rows" },
      { status: 400 }
    );
  }

  // Guardrail 2 — must actually be stuck. If task_id is present, the row
  // already has a Veo task in flight; the normal status endpoint should
  // be polled instead.
  if (row.task_id) {
    return NextResponse.json({
      ok: true,
      already_has_task_id: true,
      task_id: row.task_id,
      note: "Row already has a task_id — use the regular status endpoint",
    });
  }

  // Guardrail 3 — must have a usable start frame. Three sources in order
  // of preference:
  //   (1) anchor_frame_refined_url — refine already completed + saved
  //   (2) refine_banana_task_id    — refine was accepted upstream but
  //                                  after() died mid-poll. Resume the
  //                                  poll here, save the result, use it.
  //   (3) anchor_frame_url         — raw HD canvas frame (no refine).
  //   (4) reference_url            — last-resort, whatever the row knew.
  const meta = (row.metadata || {}) as Record<string, any>;
  let startUrl = String(meta.anchor_frame_refined_url || "").trim();
  let recoverPath: "refined" | "resumed-poll" | "raw" | "ref" = "refined";
  let resumedRefineUrl: string | null = null;

  if (!startUrl && meta.refine_banana_task_id && meta.refine_banana_provider) {
    // (2) Resume the in-flight Banana Pro task. Short timeout here so
    // the recover endpoint itself doesn't hang for minutes.
    const provider = String(meta.refine_banana_provider) as "p1" | "p2" | "p3";
    const taskId = String(meta.refine_banana_task_id);
    const polled = await pollRefineTask(provider, taskId, 45_000);
    if (polled.ok) {
      startUrl = polled.url;
      resumedRefineUrl = polled.url;
      recoverPath = "resumed-poll";
    } else {
      console.warn(
        `[recover-seg2] resume-poll on ${provider}/${taskId} failed:`,
        polled.error
      );
    }
  }
  if (!startUrl) {
    startUrl = String(meta.anchor_frame_url || "").trim();
    if (startUrl) recoverPath = "raw";
  }
  if (!startUrl) {
    startUrl = String(row.reference_url || "").trim();
    if (startUrl) recoverPath = "ref";
  }
  if (!startUrl) {
    return NextResponse.json(
      { error: "No anchor frame on this row — can't recover" },
      { status: 400 }
    );
  }

  const prompt = String(row.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Row missing prompt" }, { status: 400 });
  }

  const cfg = await getP2Config();
  const bucket = String(meta.bucket || "ugc");
  const model = bucket === "cinema" ? cfg.grokI2V : cfg.videoR2V;
  if (!model) {
    return NextResponse.json({ error: "Video model not configured" }, { status: 500 });
  }

  const aspectRatio = String(meta.aspectRatio || meta.aspect_ratio || "9:16");
  const duration = Number(row.duration || meta.extend_seconds || 8);

  // Refined frame already has the product baked in pixel-perfectly, so
  // we send ONLY that single ref to Veo (no separate product attachment,
  // no triplicate — same skipR2VTriplicate path the main extend after()
  // uses). Direct p2CreateTask (no cascade) to match the original
  // extend after() pattern.
  const created = await p2CreateTask({
    model,
    userId: user.id,
    prompt,
    imageUrls: [startUrl],
    durationMode: String(duration),
    aspectRatio,
    imageMode: bucket === "cinema" ? "frame" : "ingredient",
    skipR2VTriplicate: true,
  });

  if (!created.ok || !created.task_id) {
    await admin
      .from("history")
      .update({
        status: "failed",
        error_message: `Recover failed: ${created.error || "no task_id"}`,
        metadata: {
          ...meta,
          recover_attempted_at: new Date().toISOString(),
          recover_error: created.error || "unknown",
          recover_path: recoverPath,
        },
      })
      .eq("id", row.id);
    return NextResponse.json(
      { error: created.error || "Recover failed" },
      { status: 502 }
    );
  }

  // Stamp the task_id + provider so settle / poll picks up the result.
  const metaUpdate: Record<string, any> = {
    ...meta,
    provider: created.provider || "p2",
    recovered_at: new Date().toISOString(),
    recover_path: recoverPath,
    recover_used_refined_frame:
      recoverPath === "refined" || recoverPath === "resumed-poll",
    upload_status: "done",
  };
  if (resumedRefineUrl) {
    metaUpdate.anchor_frame_refined_url = resumedRefineUrl;
  }
  await admin
    .from("history")
    .update({
      status: "pending",
      task_id: created.task_id,
      error_message: null,
      reference_url: startUrl,
      metadata: metaUpdate,
    })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    history_id: row.id,
    task_id: created.task_id,
    provider: created.provider || "p2",
    recover_path: recoverPath,
    used_refined_frame:
      recoverPath === "refined" || recoverPath === "resumed-poll",
  });
}
