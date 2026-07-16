import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { settleHistoryRow } from "@/lib/settle";

// POST /api/extension/generate-cover  { history_id, cover_title?, cover_subtitle? }
//
// Generates a 9:16 doodle-style COVER THUMBNAIL for a finished video, to be
// uploaded to TikTok's "Upload cover" slot instead of picking a middle frame.
//
// Inputs (all already on the row):
//   • metadata.poster_url  → the video's first frame = the cover's subject
//   • metadata.image_urls  → the product photo (optional 2nd reference)
//   • cover_title / subtitle (body overrides, else the row's saved values)
//
// Flow: build a dynamic prompt → image cascade (gpt-image-2 primary, then the
// admin image-fallback tiers) → poll-settle inline (reusing the exact provider
// dispatch + B2 rehost + deduct the cron uses) → stamp cover_thumbnail_url on
// the SOURCE video. Charged like a normal image generation.
//
// Graceful degradation: any failure (gen error, not ready within the budget)
// returns { ok:false } with HTTP 200 so the extension SKIPS the cover and
// falls back to the normal frame-middle flow — a cover must never block a post.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROW_SELECT =
  "id, user_id, type, tab, status, task_id, duration, cost, prompt, reference_url, project_id, metadata, error_message, created_at, segment_index, parent_history_id, frame_anchor, output_url, merged_url";

// Dynamic doodle-cover prompt from the video's Cover Title + Subtitle.
// gpt-image-2 is primary because it renders headline text most reliably —
// a verbatim title/subtitle is the whole point of a cover.
function buildCoverPrompt(title: string, subtitle: string, hasProduct: boolean): string {
  const productLine = hasProduct
    ? `Reference image 2 is the PRODUCT — show it clearly and reproduce its packaging, label text, logo and colours EXACTLY (never restyle, recolour or invent). `
    : ``;
  const headline = title ? `Add a bold headline reading EXACTLY "${title}"` : `Add a short bold headline`;
  const sub = subtitle ? ` and a smaller subheadline reading EXACTLY "${subtitle}"` : ``;
  return (
    `Design ONE vertical 9:16 TikTok cover thumbnail in a playful doodle / sticker theme. ` +
    `Reference image 1 is the main subject (the presenter) — keep their face, expression and pose. ` +
    productLine +
    `${headline}${sub}, in a clean white sans-serif font, spelled VERBATIM character-for-character — no misspelling, no extra or substituted words. ` +
    `Slightly blur the background and draw a white sticker-style outline around the subject. Add tasteful hand-drawn doodle accents. ` +
    `Enhance the colours so it looks natural, bright and scroll-stopping. ` +
    `Keep the headline and the subject inside the CENTRE safe zone — TikTok centre-crops the cover for the profile grid, so put nothing important at the extreme top or bottom edge. ` +
    `Vertical 9:16 portrait, full-bleed, high quality.`
  );
}

export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: src } = await admin
    .from("history")
    .select("id, user_id, project_id, status, output_url, reference_url, metadata")
    .eq("id", historyId)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (src.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (src.status !== "done") return NextResponse.json({ error: "Video not finished yet" }, { status: 409 });

  const meta = (src.metadata as Record<string, any>) || {};
  // Idempotent — a cover already generated for this video is reused, so a retry
  // or a re-opened picker never re-charges or re-generates.
  if (meta.cover_thumbnail_url) {
    return NextResponse.json({ ok: true, cover_thumbnail_url: meta.cover_thumbnail_url, cached: true });
  }

  const coverTitle = String(body?.cover_title ?? meta.cover_title ?? "").trim();
  const coverSubtitle = String(body?.cover_subtitle ?? meta.cover_subtitle ?? "").trim();

  // First frame (poster) = the subject; product photo (if any) = 2nd reference.
  const firstFrame = String(meta.poster_url || src.reference_url || "").trim();
  if (!firstFrame) {
    return NextResponse.json({ error: "No first-frame poster available for this video" }, { status: 422 });
  }
  const productImg =
    (Array.isArray(meta.image_urls) ? meta.image_urls : []).filter((u: any) => typeof u === "string" && u.trim())[0] || "";
  const refImages = [firstFrame, ...(productImg ? [productImg] : [])];
  const prompt = buildCoverPrompt(coverTitle, coverSubtitle, !!productImg);

  // Charge like a normal image generation. Pre-flight so we fail fast (before
  // inserting a row) when the client can't afford it.
  const cost = await priceFor(user.id, "image_generate", "gpt_image");
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json({ error: "Insufficient credits", needed: cost }, { status: 402 });
  }

  // The cover row lives under tab='image' (so pricing/settle treat it as an
  // image gen) but is tagged feature='cover-thumbnail' + cover_for so the
  // dashboard Images grid filters it out — it's a byproduct, not a
  // user-requested image. The extension's video picker filters by video tabs,
  // so it never sees this row either.
  const { data: coverRow, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: src.project_id ?? null,
      type: "image",
      tab: "image",
      status: "pending",
      prompt,
      reference_url: firstFrame,
      cost,
      metadata: {
        feature: "cover-thumbnail",
        cover_for: historyId,
        aspectRatio: "9:16",
        image_urls: refImages,
        model: "gpt-image-2",
        upload_status: "queued",
      },
    })
    .select("id")
    .single();
  if (insErr || !coverRow) return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
  const coverId = coverRow.id;

  // Fire the cascade (gpt-image-2 primary → admin image-fallback tiers).
  const gen = await generateImageWithCascade({ primaryModel: "gpt-image-2", prompt, aspectRatio: "9:16", imageUrls: refImages });
  if (!gen.ok) {
    await admin.from("history").update({ status: "failed", error_message: gen.error }).eq("id", coverId);
    // 200 + ok:false → extension skips to the normal frame flow.
    return NextResponse.json({ ok: false, error: gen.error || "Cover generation failed" });
  }
  await admin
    .from("history")
    .update({
      task_id: gen.taskId,
      metadata: {
        feature: "cover-thumbnail",
        cover_for: historyId,
        aspectRatio: "9:16",
        image_urls: refImages,
        model: gen.actualModel,
        provider: gen.actualProvider,
        slot: gen.actualSlot,
        upload_status: "done",
      },
    })
    .eq("id", coverId);

  // Poll-settle inline until the image lands. ~48s budget inside the 60s
  // maxDuration. settleHistoryRow does the provider poll + B2 rehost + the
  // single deduct on pending→done (its own guards prevent a double charge if
  // the cron settles the same row concurrently).
  const deadline = Date.now() + 48_000;
  let coverUrl = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: row } = await admin.from("history").select(ROW_SELECT).eq("id", coverId).maybeSingle();
    if (!row) break;
    if (row.status === "done" && row.output_url) {
      coverUrl = row.output_url;
      break;
    }
    if (row.status === "failed") break;
    const res = await settleHistoryRow(row as any).catch(() => null);
    if (res && res.state === "settled" && res.status === "done" && (res as any).outputUrl) {
      coverUrl = (res as any).outputUrl;
      break;
    }
  }

  if (!coverUrl) {
    // Not ready within the budget (or failed). The client SKIPS → normal
    // frame-middle flow. The cover row keeps settling via cron; if it lands
    // later it just sits unused (harmless — already paid for as an image).
    return NextResponse.json({ ok: false, error: "Cover not ready in time", pending: true });
  }

  // Stamp the cover on the SOURCE video so the post job and a re-opened picker
  // both find it without regenerating.
  const { data: fresh } = await admin.from("history").select("metadata").eq("id", historyId).single();
  await admin
    .from("history")
    .update({ metadata: { ...((fresh?.metadata as Record<string, any>) || {}), cover_thumbnail_url: coverUrl, cover_thumbnail_row: coverId } })
    .eq("id", historyId);

  return NextResponse.json({ ok: true, cover_thumbnail_url: coverUrl });
}
