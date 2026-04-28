// Resolve a single pending history row against P2 — used by both the
// browser-driven /api/generate/status route AND the Vercel Cron worker
// (/api/worker/poll-pending). Idempotent: only flips on the
// pending → done|failed transition, deduct fires once.
//
// Side-effect on success: also auto-saves the prompt to saved_prompts so the
// user's library builds up with every generation. Idempotent — only inserts
// once per history_id (history_id has FK so duplicate inserts are caught by
// the dedupe check).

import { createAdminClient } from "@/lib/supabase/admin";
import { p2GetStatus } from "@/lib/p2";
import { deduct } from "@/lib/deduct";
import { onSegmentSettled } from "@/lib/segment-chain";

export type HistoryRow = {
  id: string;
  user_id: string;
  type: string;
  tab?: string | null;
  status: string;
  task_id: string | null;
  duration?: number | null;
  cost?: number | string | null;
  // The fields below aren't always selected at every call site, but settle
  // reads the whole row when it can — these are best-effort for auto-save.
  prompt?: string | null;
  reference_url?: string | null;
  project_id?: string | null;
  metadata?: any;
  // 16s + Extend chain fields (read by onSegmentSettled hook)
  segment_index?: number | null;
  parent_history_id?: string | null;
  frame_anchor?: string | null;
  output_url?: string | null;
  merged_url?: string | null;
};

// Map a history.tab value to the saved_prompts.bucket enum.
function bucketForTab(tab: string | null | undefined): string {
  switch (tab) {
    case "video":
    case "ugc":
      return "ugc";
    case "cinema":
      return "cinema";
    case "image":
      return "image";
    case "auto":
      return "auto";
    case "clone":
      return "ugc"; // clone outputs are UGC-style, library it under UGC
    default:
      return "ugc";
  }
}

// Insert into saved_prompts after a successful generation. Best-effort —
// failures here never break the settle path. Dedupes on history_id so the
// poll-worker hitting the same row twice can't create duplicates.
async function autoSavePrompt(
  admin: ReturnType<typeof createAdminClient>,
  hist: HistoryRow & { prompt?: string | null; reference_url?: string | null; project_id?: string | null; metadata?: any }
): Promise<void> {
  try {
    if (!hist.prompt || !hist.prompt.trim()) return;

    // Dedupe — if a row already exists for this history_id, skip
    const { data: existing } = await admin
      .from("saved_prompts")
      .select("id")
      .eq("history_id", hist.id)
      .maybeSingle();
    if (existing) return;

    const meta = hist.metadata || {};
    await admin.from("saved_prompts").insert({
      user_id: hist.user_id,
      project_id: hist.project_id || null,
      history_id: hist.id,
      prompt_text: hist.prompt,
      bucket: bucketForTab(hist.tab),
      model: meta.model || null,
      reference_url: hist.reference_url || null,
      duration: hist.duration ?? null,
      aspect_ratio: meta.aspectRatio || meta.aspect_ratio || null,
      cost: Number(hist.cost || 0),
      outcome: "success",
      source: "auto",
    });
  } catch {
    // Library is a nice-to-have; don't break the settle path on any error.
  }
}

export type SettleResult =
  | { state: "settled"; status: "done" | "failed"; outputUrl?: string; error?: string }
  | { state: "pending"; p2Status: string }
  | { state: "skipped"; reason: string };

export async function settleHistoryRow(hist: HistoryRow): Promise<SettleResult> {
  if (hist.status === "done" || hist.status === "failed") {
    return { state: "skipped", reason: "already settled" };
  }
  if (!hist.task_id) {
    return { state: "skipped", reason: "no task_id" };
  }

  // Pick the backend the row was originally created on. metadata.provider
  // is "p1" (GeminiGen) or "p2" (Crun.ai). Defaults to p2 if missing —
  // rows inserted before the multi-provider dispatcher landed all came
  // from Crun.
  const rowProvider =
    (hist.metadata?.provider as "p1" | "p2" | undefined) === "p1" ? "p1" : "p2";
  const r = await p2GetStatus(hist.task_id, rowProvider);
  const admin = createAdminClient();

  if (r.status === "succeeded" && r.outputUrl) {
    const reason =
      hist.type === "image"
        ? "image_generate"
        : hist.tab === "cinema"
          ? "cinema"
          : hist.duration === 16
            ? "video_16s"
            : "video_8s";

    if (Number(hist.cost || 0) > 0) {
      await deduct(hist.user_id, reason as any, Number(hist.cost), hist.id);
    }

    await admin
      .from("history")
      .update({
        status: "done",
        output_url: r.outputUrl,
        thumbnail_url: hist.type === "video" ? r.outputUrl : null,
      })
      .eq("id", hist.id);

    // Auto-save the prompt to the user's library. Best-effort — a failure
    // here never breaks the generation path.
    await autoSavePrompt(admin, hist);

    // Segment chain hook — for 16s clips and Extend chains. If this row is
    // seg-1 of a 16s clip, fires seg-2. If it's seg-2 (or an Extend
    // continuation), merges with the parent. No-op for everything else.
    // Best-effort — chain failure never breaks the settle path.
    await onSegmentSettled({ ...hist, output_url: r.outputUrl }, r.outputUrl).catch(
      (e) => console.error("[settle] onSegmentSettled threw:", e)
    );

    return { state: "settled", status: "done", outputUrl: r.outputUrl };
  }

  if (r.status === "failed") {
    await admin
      .from("history")
      .update({ status: "failed", error_message: r.error || "Generation failed" })
      .eq("id", hist.id);
    return { state: "settled", status: "failed", error: r.error };
  }

  return { state: "pending", p2Status: r.status };
}
