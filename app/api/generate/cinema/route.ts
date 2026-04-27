import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceAndCheck } from "@/lib/deduct";
import { getCinemaRate, getP2Config } from "@/lib/settings";

// Cinema — Grok Imagine via Crun.ai. Two image modes:
//   • text  → grok-imagine/t2v (no img_urls, takes aspect_ratio)
//   • image → grok-imagine/i2v (single img_urls, no aspect_ratio)
// Duration is a slider 6-30 (integer seconds). Resolution 480p|720p (default
// 720p). Mode hardcoded to "normal". Price = duration * cinema_rate_per_sec.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim().substring(0, 5000);
  const imageUrl = body?.image_url ? String(body.image_url) : "";
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const resolution = body?.resolution === "480p" ? "480p" : "720p";
  const duration = Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
  const imageMode = body?.image_mode === "image" ? "image" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  if (imageMode === "image" && !imageUrl) {
    return NextResponse.json(
      { error: "Reference image required for Image-to-Video mode" },
      { status: 400 }
    );
  }

  // Pricing — resolve rate and credits in one combined query
  const ratePerSec = await getCinemaRate();
  const cost = Number((ratePerSec * duration).toFixed(4));
  const { hasFunds } = await priceAndCheck(user.id, "cinema", cost);
  if (!hasFunds) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu RM${cost.toFixed(2)}.` },
      { status: 402 }
    );
  }

  const cfg = await getP2Config();
  const model = imageMode === "image" ? cfg.grokI2V : cfg.grokT2V;
  if (!model) {
    return NextResponse.json({ error: "Cinema model not configured" }, { status: 500 });
  }

  const created = await p2CreateTask({
    model,
    prompt,
    imageUrls: imageMode === "image" && imageUrl ? [imageUrl] : [],
    durationMode: String(duration),
    aspectRatio,
    resolution,
    extra: { mode: "normal" },
  });
  if (!created.ok || !created.task_id) {
    return NextResponse.json(
      { error: created.error || "Cinema create failed" },
      { status: 502 }
    );
  }

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "cinema",
      status: "pending",
      prompt,
      reference_url: imageUrl || null,
      task_id: created.task_id,
      duration,
      cost,
      metadata: {
        model,
        imageMode,
        resolution,
        aspectRatio: imageMode === "image" ? null : aspectRatio,
        cinemaProvider: "grok-imagine",
      },
    })
    .select()
    .single();

  return NextResponse.json({
    ok: true,
    history_id: hist?.id,
    task_id: created.task_id,
    cost,
    duration,
    rate_per_sec: ratePerSec,
  });
}
