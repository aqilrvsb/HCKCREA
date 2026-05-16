import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { priceAndCheck } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { falExtractFrame } from "@/lib/fal";

// POST /api/generate/extend
// Takes an existing completed video (history_id) and generates another 8s
// segment. The continuation flow mirrors creative-hack-auto's apiExtractFrame
// + slideType==='extend' path:
//
// image_mode = "frame" (default for Extend / Improve):
//   • start_frame_url uploaded → use it
//   • start_frame_url empty   → fal.ai extracts last frame of parent.output_url
//                                and uses that JPG as start frame
//   • end_frame_url uploaded  → pass through (i2v with both bookends)
//   • end_frame_url empty     → no end frame (i2v with start only)
//   → model = videoI2V
//
// image_mode = "ingredient":
//   • start_frame_url contains the product reference image
//   → model = videoR2V
//
// image_mode = "text":
//   • no frames at all
//   → model = videoT2V
//
// Result is a new history row tied via metadata.parent_id so the UI shows the
// extension under the same parent. Same endpoint serves Extend + Improve +
// Auto Content extend (all three send the same body shape).
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parentId = String(body?.parent_id || "");
  const userPrompt = String(body?.continuation_prompt || "").trim();
  const startFrameOverride = body?.start_frame_url ? String(body.start_frame_url) : "";
  const endFrameUrl = body?.end_frame_url ? String(body.end_frame_url) : "";
  const requestedMode = body?.image_mode as
    | "frame"
    | "ingredient"
    | "text"
    | undefined;
  if (!parentId) return NextResponse.json({ error: "Missing parent_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: parent } = await admin
    .from("history")
    .select("*")
    .eq("id", parentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!parent) return NextResponse.json({ error: "Parent not found" }, { status: 404 });
  if (parent.status !== "done" || !parent.output_url) {
    return NextResponse.json(
      { error: "Parent video not ready for extend" },
      { status: 400 }
    );
  }

  const { rate: cost, hasFunds } = await priceAndCheck(user.id, "video_8s");
  if (!hasFunds) {
    return NextResponse.json({ error: "Kredit tak cukup. Top up dulu." }, { status: 402 });
  }

  const cfg = await getP2Config();

  // Resolve mode — default to "frame" (the Extend/Improve flow).
  const imageMode: "frame" | "ingredient" | "text" =
    requestedMode === "ingredient" || requestedMode === "text"
      ? requestedMode
      : "frame";

  // Resolve the start frame for frame mode:
  //   • user-uploaded override → use as-is
  //   • else → fal.ai extracts last frame of parent.output_url
  // Hard-fail if fal extract fails (matches extension's STRICT no-fallback
  // rule — silently re-running r2v with the product image would produce a
  // jarring scene cut, which is what we're trying to avoid).
  let startUrl = startFrameOverride;
  let extractedFromFal = false;

  if (imageMode === "frame" && !startUrl) {
    const ext = await falExtractFrame(parent.output_url, "last");
    if (!ext.ok || !ext.url) {
      return NextResponse.json(
        {
          error: `Last frame extraction failed: ${ext.error || "unknown"}. Please upload a start frame manually.`,
        },
        { status: 502 }
      );
    }
    startUrl = ext.url;
    extractedFromFal = true;
  } else if (imageMode === "ingredient" && !startUrl) {
    return NextResponse.json(
      { error: "Product reference image required for ingredient mode" },
      { status: 400 }
    );
  }

  // Pick model by mode
  const model =
    imageMode === "text"
      ? cfg.videoT2V
      : imageMode === "ingredient"
        ? cfg.videoR2V
        : cfg.videoI2V;

  if (!model) {
    return NextResponse.json({ error: "P2 video model missing" }, { status: 500 });
  }

  // Build prompt — fall back to a smooth-continuation default if user didn't
  // type anything (matches the modal which makes the field required, but the
  // server stays defensive).
  const continuationPrompt = userPrompt
    ? userPrompt
    : `${parent.prompt || ""}\n\n[CONTINUATION SHOT — extend the previous scene smoothly. Keep same character, outfit, scene, and lighting. New camera angle or action beat.]`;

  // Frame mode: send [start, end?] for i2v bookends.
  // Ingredient: single product image as r2v reference.
  // Text: no images.
  const imageUrls =
    imageMode === "text"
      ? []
      : imageMode === "frame"
        ? [startUrl, endFrameUrl].filter(Boolean)
        : [startUrl].filter(Boolean);

  // Video cascade: p2 → p1 → p3 with Veo 3.1. Product-ref triplicate
  // fires automatically for ingredient mode + single image.
  const cascaded = await generateVideoWithCascade({
    primaryModel: model,
    userId: user.id,
    prompt: continuationPrompt,
    imageUrls,
    durationMode: "8",
    aspectRatio: "9:16",
    imageMode:
      imageMode === "frame"
        ? "frame"
        : imageMode === "ingredient"
          ? "ingredient"
          : "text",
  });
  if (!cascaded.ok) {
    return NextResponse.json({ error: cascaded.error }, { status: 502 });
  }
  const created: { ok: true; task_id: string; provider: "p1" | "p2" | "p3" | "p4" | "p5" | "p6" } = {
    ok: true,
    task_id: cascaded.taskId,
    provider: cascaded.actualProvider,
  };

  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: (parent as any).project_id || null,
      type: "video",
      tab: parent.tab, // keep in same tab as parent (ugc / cinema / auto)
      status: "pending",
      prompt: continuationPrompt,
      reference_url: startUrl || null,
      task_id: created.task_id,
      duration: 8,
      cost,
      metadata: {
        parent_id: parent.id,
        is_extension: true,
        model: cascaded.actualModel,
        provider: cascaded.actualProvider,
        slot: cascaded.actualSlot,
        fallback_used: cascaded.fallbackUsed,
        tier_log: cascaded.tierLog,
        image_mode: imageMode,
        end_frame_url: endFrameUrl || null,
        start_frame_source: extractedFromFal
          ? "fal_extract_last"
          : startFrameOverride
            ? "user_upload"
            : "none",
      },
    })
    .select()
    .single();

  return NextResponse.json({
    ok: true,
    history_id: hist?.id,
    task_id: created.task_id,
    cost,
    parent_id: parent.id,
    image_mode: imageMode,
    start_frame_extracted: extractedFromFal,
  });
}
