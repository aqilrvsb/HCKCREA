import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// imageMode: 'frame' = i2v (start frame), 'ingredient' = r2v (ref product),
// 'text' = t2v (text-only)
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const imageUrls: string[] = Array.isArray(body?.image_urls) ? body.image_urls : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const durationMode: "8" | "16" = body?.duration === "16" ? "16" : "8";
  const imageMode: "frame" | "ingredient" | "text" =
    body?.image_mode === "text" ? "text" : imageUrls.length ? "ingredient" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode !== "text" && !imageUrls.length) {
    return NextResponse.json({ error: "Reference image required" }, { status: 400 });
  }

  const reason = durationMode === "16" ? "video_16s" : "video_8s";
  const cost = await priceFor(user.id, reason as any);
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json({ error: "Kredit tak cukup. Top up dulu." }, { status: 402 });
  }

  const cfg = await getP2Config();
  const model =
    imageMode === "text"
      ? cfg.videoT2V
      : imageMode === "ingredient"
        ? cfg.videoR2V
        : cfg.videoI2V;
  if (!model) return NextResponse.json({ error: "P2 video model missing" }, { status: 500 });

  const created = await p2CreateTask({
    model,
    prompt,
    imageUrls,
    durationMode,
    aspectRatio,
    imageMode,
  });
  if (!created.ok || !created.task_id) {
    return NextResponse.json({ error: created.error || "P2 create failed" }, { status: 502 });
  }

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "video",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] || null,
      task_id: created.task_id,
      duration: durationMode === "16" ? 16 : 8,
      cost,
      metadata: { aspectRatio, imageMode, model },
    })
    .select()
    .single();

  return NextResponse.json({
    ok: true,
    history_id: hist?.id,
    task_id: created.task_id,
    cost,
  });
}
