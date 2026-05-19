import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting, getCinemaRate } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";

// POST /api/generate/sora2 — Sora 2 tab.
//
// OpenAI Sora 2 via APIPod (model='sora-2-vip'). Took the Grok slot
// in the nav per user direction (Grok server unstable).
//
// API constraints (per APIPod sora-2-vip spec):
//   - durations: 4 / 8 / 12 ONLY
//   - aspect_ratio: 9:16 OR 16:9 ONLY
//   - image_url: SINGLE first frame
//   - dimensions: 720×1280 (9:16) or 1280×720 (16:9)
//   - real portrait photos likely fail
//
// Provider routing: APIPod ONLY (no other provider hosts Sora 2).
// Uses the first configured p6 slot from settings. If admin wants
// fallback to a different p6 key, they can add multiple sora2-tagged
// slots later.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim().substring(0, 4000);
  const imageUrl = body?.image_url ? String(body.image_url) : "";
  const aspectRatio: "9:16" | "16:9" =
    body?.aspect_ratio === "16:9" ? "16:9" : "9:16";
  // 4s removed from client UI per user direction — backend defaults
  // to 8s if anything other than 8 or 12 is sent.
  const duration: 8 | 12 =
    body?.duration === 12 ? 12 : 8;
  const imageMode: "text" | "image" =
    body?.image_mode === "image" && imageUrl ? "image" : "text";
  const projectId = body?.project_id ? String(body.project_id) : null;

  if (!prompt) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (imageMode === "image" && !imageUrl) {
    return NextResponse.json(
      { error: "First-frame image required for image mode" },
      { status: 400 }
    );
  }

  // Rate per second — admin can set sora2_rate, falls back to cinema
  // rate × 2 (Sora 2 is roughly twice the Grok cost per docs).
  const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
  const cinemaRate = await getCinemaRate();
  const ratePerSec =
    typeof sora2RateSetting?.rate === "number"
      ? sora2RateSetting.rate
      : cinemaRate * 2;
  const cost = Number((ratePerSec * duration).toFixed(4));

  // Insert placeholder row immediately so the client sees the card
  // appear. task_id + status update in after().
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "sora2",
      status: "pending",
      prompt,
      reference_url: imageUrl || null,
      task_id: null,
      duration,
      cost,
      metadata: {
        aspectRatio,
        imageMode,
        resolution: aspectRatio === "9:16" ? "720x1280" : "1280x720",
        sora2Provider: "apipod",
        modelChoice: "sora2",
        model: "sora-2-vip",
        featureType: "sora2",
        image_urls: imageUrl ? [imageUrl] : [],
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
      // Route through the same cascade infrastructure as other tabs —
      // asset='sora2' picks from sora2_main_slots / sora2_fallback_slots
      // via round-robin counter. Same retry / event-driven failover
      // semantics as video / grok / cinema cascades.
      const cascaded = await generateVideoWithCascade({
        primaryModel: "sora2", // p6.ts maps to sora-2-vip
        userId: user.id,
        prompt,
        imageUrls: imageUrl ? [imageUrl] : [],
        imageMode: imageMode === "image" ? "frame" : "text",
        aspectRatio,
        durationMode: String(duration),
        asset: "sora2",
      });

      if (!cascaded.ok) {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: cascaded.error || "Sora 2 cascade exhausted",
            metadata: {
              aspectRatio,
              imageMode,
              resolution: aspectRatio === "9:16" ? "720x1280" : "1280x720",
              sora2Provider: "apipod",
              modelChoice: "sora2",
              model: "sora-2-vip",
              featureType: "sora2",
              fallback_used: cascaded.tierLog ? true : false,
              tier_log: cascaded.tierLog,
              image_urls: imageUrl ? [imageUrl] : [],
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
        return;
      }

      await admin
        .from("history")
        .update({
          task_id: cascaded.taskId,
          metadata: {
            aspectRatio,
            imageMode,
            resolution: aspectRatio === "9:16" ? "720x1280" : "1280x720",
            sora2Provider: "apipod",
            modelChoice: "sora2",
            model: cascaded.actualModel || "sora-2-vip",
            provider: cascaded.actualProvider,
            slot: cascaded.actualSlot,
            featureType: "sora2",
            fallback_used: cascaded.fallbackUsed,
            tier_log: cascaded.tierLog,
            image_urls: imageUrl ? [imageUrl] : [],
            upload_status: "queued",
          },
        })
        .eq("id", historyId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Sora 2 backend error",
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId });
}
