// Resolve a single pending history row against P2 — used by both the
// browser-driven /api/generate/status route AND the Vercel Cron worker
// (/api/worker/poll-pending). Idempotent: only flips on the
// pending → done|failed transition, deduct fires once.

import { createAdminClient } from "@/lib/supabase/admin";
import { p2GetStatus } from "@/lib/p2";
import { deduct } from "@/lib/deduct";

export type HistoryRow = {
  id: string;
  user_id: string;
  type: string;
  tab?: string | null;
  status: string;
  task_id: string | null;
  duration?: number | null;
  cost?: number | string | null;
};

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

  const r = await p2GetStatus(hist.task_id);
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
