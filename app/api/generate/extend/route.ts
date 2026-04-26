import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// POST /api/generate/extend
// Takes an existing completed video (history_id) and generates another 8s
// segment using the same prompt/reference. Result is a new history row tied
// via metadata.parent_id so the UI can show them together.
//
// Note: a true "extend" would extract the last frame of the parent video and
// use it as i2v start frame. That requires fal.ai frame extract — wired as
// a follow-up. For now we re-run the same r2v prompt which produces a
// continuation-ish clip.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parentId = String(body?.parent_id || "");
  // Optional overrides — let the user steer the continuation
  const userPrompt = String(body?.continuation_prompt || "").trim();
  const startFrameOverride = body?.start_frame_url ? String(body.start_frame_url) : "";
  const endFrameUrl = body?.end_frame_url ? String(body.end_frame_url) : "";
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

  const cost = await priceFor(user.id, "video_8s");
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json({ error: "Kredit tak cukup. Top up dulu." }, { status: 402 });
  }

  const cfg = await getP2Config();
  // Start frame: user override > parent reference > parent output
  const startUrl = startFrameOverride || parent.reference_url || parent.output_url;
  // If user picked an end frame, this becomes a frame-mode (i2v) extension.
  const useFrameMode = !!endFrameUrl;
  const model = useFrameMode
    ? cfg.videoI2V
    : parent.reference_url
      ? cfg.videoR2V
      : cfg.videoI2V;

  const continuationPrompt = userPrompt
    ? userPrompt
    : `${parent.prompt || ""}\n\n[CONTINUATION SHOT — extend the previous 8 seconds smoothly. Keep same character, outfit, scene, and lighting. New camera angle or action beat.]`;

  const imageUrls = useFrameMode
    ? [startUrl, endFrameUrl].filter(Boolean)
    : startUrl ? [startUrl] : [];

  const created = await p2CreateTask({
    model,
    prompt: continuationPrompt,
    imageUrls,
    durationMode: "8",
    aspectRatio: "9:16",
    imageMode: useFrameMode ? "frame" : parent.reference_url ? "ingredient" : "frame",
  });
  if (!created.ok || !created.task_id) {
    return NextResponse.json({ error: created.error || "P2 create failed" }, { status: 502 });
  }

  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: (parent as any).project_id || null,
      type: "video",
      tab: parent.tab, // keep in same tab as parent
      status: "pending",
      prompt: continuationPrompt,
      reference_url: startUrl,
      task_id: created.task_id,
      duration: 8,
      cost,
      metadata: {
        parent_id: parent.id,
        is_extension: true,
        model,
        end_frame_url: endFrameUrl || null,
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
  });
}
