import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasEnoughCredits } from "@/lib/deduct";
import { klingCreateWithCascade, getKlingRate } from "@/lib/kling";

// POST /api/generate/template-body — Livehost "Template Body" (Kling v3
// motion-control). Body: { image_url (avatar/character), video_url (uploaded
// motion .mp4), prompt?, mode? "std"|"pro", character_orientation?, keep_original_sound? }.
//
// Row: type "video", tab "template-body". Created pending; after() runs the
// Kling cascade (main Crun key → fallback) and stamps the slot LABEL (never
// the key). Settled by the shared lib/settle.ts path (callback + cron + the
// /api/generate/status client poll) — it resolves the kling key from the slot.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const imageUrl = String(body?.image_url || "").trim();
  const videoUrl = String(body?.video_url || "").trim();
  const prompt = String(body?.prompt || "").trim();
  const mode: "std" | "pro" = body?.mode === "std" ? "std" : "pro";
  const characterOrientation: "image" | "video" = body?.character_orientation === "image" ? "image" : "video";
  // Audio default OFF (hidden in UI). Only ON when explicitly requested.
  const keepOriginalSound = body?.keep_original_sound === true;
  const projectId = body?.project_id ? String(body.project_id) : null;
  // Output length follows the reference video — client measures the .mp4
  // duration and sends it so we can bill per-second. Clamp to a sane range.
  const duration = Math.max(1, Math.min(120, Math.round(Number(body?.duration) || 8)));

  if (!imageUrl) return NextResponse.json({ error: "Pilih avatar (character image) dahulu." }, { status: 400 });
  if (!videoUrl) return NextResponse.json({ error: "Upload video gerakan (motion .mp4) dahulu." }, { status: 400 });
  if (prompt.length > 2500) return NextResponse.json({ error: "Prompt too long (max 2500)" }, { status: 400 });

  const rate = await getKlingRate(); // RM / second
  const cost = Number((rate * duration).toFixed(4));
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json({ error: `Kredit tak cukup. Perlu RM ${cost.toFixed(2)}.` }, { status: 402 });
  }

  const baseMeta = {
    kling: true, mode, character_orientation: characterOrientation,
    keep_original_sound: keepOriginalSound, motion_url: videoUrl, image_url: imageUrl,
  };

  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id, project_id: projectId, type: "video", tab: "template-body",
      status: "pending", prompt: prompt || null, reference_url: imageUrl, task_id: null,
      duration, cost: 0, metadata: { ...baseMeta, duration, upload_status: "queued" },
    })
    .select("id")
    .single();
  if (insErr || !hist) return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  const historyId = hist.id;

  after(async () => {
    try {
      const result = await klingCreateWithCascade({
        userId: user.id, imageUrl, videoUrl, prompt, mode, characterOrientation, keepOriginalSound,
      });
      if (!result.ok) {
        await admin.from("history").update({
          status: "failed", cost,
          error_message: result.error || "Kling create failed",
          metadata: { ...baseMeta, tier_log: result.tierLog, upload_status: "failed" },
        }).eq("id", historyId);
        return;
      }
      await admin.from("history").update({
        task_id: result.taskId, cost,
        metadata: { ...baseMeta, provider: "kling", slot: result.slot, tier_log: result.tierLog, upload_status: "done" },
      }).eq("id", historyId);
    } catch (e: any) {
      await admin.from("history").update({
        status: "failed", cost,
        error_message: e?.message || "Kling background error",
        metadata: { ...baseMeta, upload_status: "failed" },
      }).eq("id", historyId);
    }
  });

  return NextResponse.json({ ok: true, history_id: historyId });
}
