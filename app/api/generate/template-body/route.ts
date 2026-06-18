import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasEnoughCredits } from "@/lib/deduct";
import { klingCreateWithCascade, getKlingRate } from "@/lib/kling";
import { uploadBufferToStoragePublic } from "@/lib/b2";
import sharp from "sharp";

// Composite the (possibly transparent) avatar onto a flat solid chroma-key
// screen so Kling's output background keys cleanly. flatten() merges any alpha
// onto the colour; opaque images are returned unchanged. Returns the new public
// URL, or the original on any failure (never blocks generation).
const CHROMA: Record<string, { r: number; g: number; b: number }> = {
  green: { r: 0, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
};
async function chromaScreenify(userId: string, historyId: string, imageUrl: string, bgColor: "green" | "blue"): Promise<string> {
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) return imageUrl;
    const inBuf = Buffer.from(await resp.arrayBuffer());
    const png = await sharp(inBuf).flatten({ background: CHROMA[bgColor] || CHROMA.green }).png().toBuffer();
    const key = `livehost-greenavatar/${userId}/${historyId}.png`;
    const { publicUrl } = await uploadBufferToStoragePublic({ body: png, key, contentType: "image/png" });
    return publicUrl || imageUrl;
  } catch {
    return imageUrl;
  }
}

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
  const bgColor: "green" | "blue" = body?.bg_color === "blue" ? "blue" : "green";
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
    keep_original_sound: keepOriginalSound, motion_url: videoUrl, image_url: imageUrl, bg_color: bgColor,
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
      // 1) Composite the avatar onto the chosen chroma background, THEN
      // 2) send that image to Kling → output keys clean.
      const klingImageUrl = await chromaScreenify(user.id, historyId, imageUrl, bgColor);
      const result = await klingCreateWithCascade({
        userId: user.id, imageUrl: klingImageUrl, videoUrl, prompt, mode, characterOrientation, keepOriginalSound,
      });
      if (!result.ok) {
        await admin.from("history").update({
          status: "failed", cost,
          error_message: result.error || "Kling create failed",
          metadata: { ...baseMeta, green_image_url: klingImageUrl, tier_log: result.tierLog, upload_status: "failed" },
        }).eq("id", historyId);
        return;
      }
      await admin.from("history").update({
        task_id: result.taskId, cost,
        metadata: { ...baseMeta, green_image_url: klingImageUrl, provider: "kling", slot: result.slot, tier_log: result.tierLog, upload_status: "done" },
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
