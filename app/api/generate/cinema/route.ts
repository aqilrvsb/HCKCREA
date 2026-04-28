import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getCinemaRate, getP2Config } from "@/lib/settings";

// POST /api/generate/cinema — Cinema tab (Grok Imagine via Crun.ai).
// Placeholder-first + auth-light, same shape as image/video routes.
//
// Two image modes:
//   • text  → grok-imagine/t2v (no img_urls, takes aspect_ratio)
//   • image → grok-imagine/i2v (single img_urls, no aspect_ratio)
// Duration: slider 6-30s. Resolution: 480p|720p. Mode: normal.
// Price = duration * cinema_rate_per_sec, computed in after().
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
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

  // Insert placeholder NOW. Cost + task_id populated by after().
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "cinema",
      status: "pending",
      prompt,
      reference_url: imageUrl || null,
      task_id: null,
      duration,
      cost: 0,
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode === "image" ? null : aspectRatio,
        cinemaProvider: "grok-imagine",
        upload_status: "queued",
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const historyId = hist.id;

  after(async () => {
    try {
      const [cfg, ratePerSec] = await Promise.all([
        getP2Config(),
        getCinemaRate(),
      ]);
      const cost = Number((ratePerSec * duration).toFixed(4));
      const model = imageMode === "image" ? cfg.grokI2V : cfg.grokT2V;

      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: "Cinema model not configured",
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode === "image" ? null : aspectRatio,
            cinemaProvider: "grok-imagine",
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
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

      const provider = created.provider || "p2";
      if (!created.ok || !created.task_id) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: created.error || "Cinema create failed",
          metadata: {
            model, imageMode, resolution,
            aspectRatio: imageMode === "image" ? null : aspectRatio,
            cinemaProvider: "grok-imagine",
            provider,
            upload_status: "failed",
          },
        }).eq("id", historyId);
        return;
      }

      await admin.from("history").update({
        task_id: created.task_id,
        cost,
        metadata: {
          model, imageMode, resolution,
          aspectRatio: imageMode === "image" ? null : aspectRatio,
          cinemaProvider: "grok-imagine",
          provider,
          upload_status: "done",
        },
      }).eq("id", historyId);
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed",
        error_message: e?.message || "Background error",
        metadata: {
          imageMode, resolution,
          aspectRatio: imageMode === "image" ? null : aspectRatio,
          cinemaProvider: "grok-imagine",
          upload_status: "failed",
        },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    duration,
  });
}
