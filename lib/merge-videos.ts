import { falMergeVideos } from "@/lib/fal";
import { rehostToContent, type StorageType } from "@/lib/b2";

// Shared background step for a "Merge of N clips" history row: concat the source clips on fal, re-host the result on
// B2, then mark the row done (or failed). Used by POST /api/merge/videos (first run) and /api/history/retry (Resubmit
// on a failed merge row — it must re-run THIS, never the AI video cascade).

export type MergeInherited = {
  cover_title: string | null;
  cover_subtitle: string | null;
  tiktok_product_id: string | null;
  product_name: string | null;
};

export async function runMergeJob(
  admin: any,
  job: { historyId: string; userId: string; tab: string; ids: string[]; sourceUrls: string[]; inherited: MergeInherited }
): Promise<void> {
  const { historyId, userId, tab, ids, sourceUrls, inherited } = job;
  const baseMeta = { merged_from: ids, merge_count: ids.length, ...inherited };
  const fail = (msg: string) =>
    admin
      .from("history")
      .update({ status: "failed", error_message: msg, metadata: { ...baseMeta, merge_status: "failed" } })
      .eq("id", historyId);
  try {
    const mergeRes = await falMergeVideos(sourceUrls);
    if (!mergeRes.ok || !mergeRes.url) {
      await fail(mergeRes.error || "Merge failed");
      return;
    }
    // Re-host the fal output on peninglab-content (same as every other generation); falls back to the fal URL.
    const sType: StorageType = tab === "auto" ? "auto" : tab === "cinema" ? "cinema" : "ugc";
    const rehosted = await rehostToContent({ url: mergeRes.url, userId, historyId, type: sType, fallbackExt: "mp4" });
    await admin
      .from("history")
      .update({
        status: "done",
        error_message: null,
        output_url: rehosted,
        merged_url: rehosted,
        thumbnail_url: rehosted,
        metadata: { ...baseMeta, merge_status: "done", merged_at: new Date().toISOString() },
      })
      .eq("id", historyId);
  } catch (e: any) {
    await fail(e?.message || "Background merge error");
  }
}

/** Source clips for a merge, in the requested order. Errors if any is missing, not the caller's, or not finished. */
export async function loadMergeSources(
  admin: any,
  ids: string[],
  ownerId: string
): Promise<{ ok: true; ordered: any[] } | { ok: false; status: number; error: string }> {
  const { data: sources, error } = await admin
    .from("history")
    .select("id, user_id, tab, status, output_url, project_id, duration, caption, metadata")
    .in("id", ids);
  if (error || !sources || sources.length !== new Set(ids).size) {
    return { ok: false, status: 404, error: "One or more source clips not found" };
  }
  for (const s of sources) {
    if (s.user_id !== ownerId) return { ok: false, status: 403, error: "Source clip does not belong to you" };
    if (s.status !== "done" || !s.output_url) {
      return { ok: false, status: 400, error: "All source clips must be finished before merging" };
    }
  }
  const byId = new Map(sources.map((s: any) => [s.id, s]));
  return { ok: true, ordered: ids.map((id) => byId.get(id)).filter(Boolean) };
}

export function inheritedFrom(first: any): MergeInherited {
  const m = (first?.metadata || {}) as Record<string, any>;
  return {
    cover_title: m.cover_title || null,
    cover_subtitle: m.cover_subtitle || null,
    tiktok_product_id: m.tiktok_product_id || null,
    product_name: m.product_name || null,
  };
}
