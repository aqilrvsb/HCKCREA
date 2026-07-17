import { createAdminClient } from "@/lib/supabase/admin";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { settleHistoryRow } from "@/lib/settle";
import { priceFor } from "@/lib/deduct";

// Biometric-grid overlay.
//
// Some video providers (Seedance / APIPod) run a "real person" biometric filter
// and reject reference images whose faces look like real people — including the
// AI-generated faces this platform makes ("The request failed because the input
// image may contain real person"). Overlaying a subtle, very thin 6x6 white
// grid breaks the face-landmark detection so the AI image passes, without
// visibly changing the content. (Omni has no such filter and never needs this.)

const ROW_SELECT =
  "id, user_id, type, tab, status, task_id, duration, cost, prompt, reference_url, project_id, metadata, error_message, created_at, segment_index, parent_history_id, frame_anchor, output_url, merged_url";

const GRID_PROMPT =
  "Add a subtle, very thin, semi-transparent white 6x6 grid overlay evenly spaced across the ENTIRE image to break biometric face landmarks. Keep EVERYTHING else pixel-identical — the same people, faces, expressions, poses, product, packaging, label text, colours and layout; do not redraw, restyle, move, add or remove anything. ONLY lay the thin white grid lines on top.";

/**
 * Return a grid-overlaid copy of `imageUrl` (generated once, then cached on the
 * source row's metadata.biometric_grid_url so a re-fire reuses it, no re-charge).
 * Charged as one image generation. Returns null on any failure — the caller then
 * falls back to the original image.
 */
export async function ensureBiometricGrid(opts: {
  userId: string;
  projectId: string | null;
  sourceHistoryId: string;
  imageUrl: string;
  cachedGridUrl?: string | null;
}): Promise<string | null> {
  if (opts.cachedGridUrl && opts.cachedGridUrl.trim()) return opts.cachedGridUrl;
  if (!opts.imageUrl) return null;

  const admin = createAdminClient();
  const cost = await priceFor(opts.userId, "image_generate", "gpt_image");

  // Hidden image row (feature=biometric-grid) so it settles + deducts like any
  // image gen but stays out of the Images grid (history-grid filters it).
  const { data: gridRow } = await admin
    .from("history")
    .insert({
      user_id: opts.userId,
      project_id: opts.projectId ?? null,
      type: "image",
      tab: "image",
      status: "pending",
      prompt: GRID_PROMPT,
      reference_url: opts.imageUrl,
      cost,
      metadata: {
        feature: "biometric-grid",
        grid_for: opts.sourceHistoryId,
        aspectRatio: "9:16",
        image_urls: [opts.imageUrl],
        model: "gpt-image-2",
        upload_status: "queued",
      },
    })
    .select("id")
    .single();
  if (!gridRow) return null;
  const gridId = gridRow.id;

  const gen = await generateImageWithCascade({
    primaryModel: "gpt-image-2",
    prompt: GRID_PROMPT,
    aspectRatio: "9:16",
    imageUrls: [opts.imageUrl],
    fullCascade: true,
  });
  if (!gen.ok) {
    await admin.from("history").update({ status: "failed", error_message: gen.error }).eq("id", gridId);
    return null;
  }
  await admin
    .from("history")
    .update({
      task_id: gen.taskId,
      metadata: {
        feature: "biometric-grid",
        grid_for: opts.sourceHistoryId,
        aspectRatio: "9:16",
        image_urls: [opts.imageUrl],
        model: gen.actualModel,
        provider: gen.actualProvider,
        slot: gen.actualSlot,
        upload_status: "done",
      },
    })
    .eq("id", gridId);

  // Poll-settle inline until the image lands (~120s budget).
  const deadline = Date.now() + 120_000;
  let gridUrl = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: row } = await admin.from("history").select(ROW_SELECT).eq("id", gridId).maybeSingle();
    if (!row) break;
    if (row.status === "done" && row.output_url) {
      gridUrl = row.output_url;
      break;
    }
    if (row.status === "failed") break;
    const res = await settleHistoryRow(row as any).catch(() => null);
    if (res && res.state === "settled" && res.status === "done" && (res as any).outputUrl) {
      gridUrl = (res as any).outputUrl;
      break;
    }
  }
  if (!gridUrl) return null;

  // Cache on the source row so a re-generation reuses it.
  const { data: src } = await admin.from("history").select("metadata").eq("id", opts.sourceHistoryId).single();
  await admin
    .from("history")
    .update({ metadata: { ...((src?.metadata as Record<string, any>) || {}), biometric_grid_url: gridUrl } })
    .eq("id", opts.sourceHistoryId);
  return gridUrl;
}
