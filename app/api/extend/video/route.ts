import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getP2Config } from "@/lib/settings";
import { priceFor } from "@/lib/deduct";
import { falExtractFrame, type FrameAnchor } from "@/lib/fal";
import { getCachedProductOcr, productTextLockBlock } from "@/lib/product-ocr";

// POST /api/extend/video — placeholder-first.
//
// Hot path (~500ms):
//   1. getSession + verify source row belongs to user
//   2. Insert seg-2 placeholder row with parent_history_id linking back
//      to the source clip and segment_index=2. The dashboard's segment
//      slider keys on this child row to render the seg-2 placeholder
//      thumb on the parent card immediately — no waiting for fal frame
//      extract, OCR, or Crun create_task.
//   3. Return seg2_history_id
//
// after() background:
//   4. Resolve plan rate
//   5. Extract anchor frame from source video (fal, ~3-5s)
//   6. Run product OCR for text lock (if product image provided)
//   7. Build full seg-2 prompt with locks
//   8. Fire Crun seg-2 create_task
//   9. Update seg-2 row with task_id, cost, locks metadata, ref frame URL
//
// On any failure during after(), the seg-2 row flips to 'failed' with the
// error message so the slider thumb shows a red X instead of forever-spin.
// pg_cron's 10-min stale cutoff catches orphan rows if after() never runs.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VOICE_MAP: Record<string, string> = {
  achernar: "Achernar — soft, high-pitched, gentle female voice. Light airy timbre.",
  achird: "Achird — friendly, mid-pitch, warm masculine voice.",
  algenib: "Algenib — gravelly, low-pitched, masculine voice. Deep rough timbre.",
  callirrhoe: "Callirrhoe — neutral mid-pitch female voice, natural conversational.",
  charon: "Charon — deep authoritative masculine voice.",
  enceladus: "Enceladus — mature warm female voice, mom-tone.",
  gacrux: "Gacrux — energetic excited masculine voice, hype.",
  iapetus: "Iapetus — young upbeat female voice, Gen Z energy.",
};

const STANDARD_LOCKS = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture, no-makeup-makeup.
VISUAL: RAW UNEDITED FOOTAGE — no subtitles, captions, sticker text, watermarks.

Negative: cartoon, anime, plastic skin, glam makeup, softbox studio lighting, duplicate limbs, distorted fingers, warped product label, text drift, multiple speakers.`;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceHistoryId = String(body?.source_history_id || "");
  const sourceVideoUrl = String(body?.source_video_url || "");
  const sourceDuration = Number(body?.source_duration || 8);
  const bucket = body?.bucket === "cinema" ? "cinema" : body?.bucket === "auto" ? "auto" : "ugc";
  const frameAnchor = (["first", "middle", "last"].includes(body?.frame_anchor)
    ? body.frame_anchor
    : "last") as FrameAnchor;
  const seg2Prompt = String(body?.seg2_prompt || "").trim();
  const characterLock = String(body?.character_lock || "").trim();
  const productImageUrl = String(body?.product_image_url || "");
  const voiceId = body?.voice ? String(body.voice) : "";
  const aspectRatio = String(body?.aspect_ratio || "9:16");

  if (!sourceHistoryId || !sourceVideoUrl) {
    return NextResponse.json(
      { error: "source_history_id and source_video_url required" },
      { status: 400 }
    );
  }
  if (!seg2Prompt) {
    return NextResponse.json({ error: "seg2_prompt required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify source row belongs to user + is settled (kept on hot path —
  // small + needed to reject hostile callers before we insert).
  const { data: source } = await admin
    .from("history")
    .select("id, user_id, status, project_id")
    .eq("id", sourceHistoryId)
    .single();
  if (!source || source.user_id !== user.id) {
    return NextResponse.json({ error: "Source clip not found" }, { status: 404 });
  }
  if (source.status !== "done") {
    return NextResponse.json(
      { error: "Source clip is not ready yet — wait for it to finish" },
      { status: 400 }
    );
  }

  // Insert seg-2 placeholder row NOW. parent_history_id + segment_index=2
  // is what makes the parent card's slider render the seg-2 thumb (pending
  // state) immediately. task_id, cost, locks metadata filled by after().
  const { data: child, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: source.project_id || null,
      type: "video",
      tab: bucket === "cinema" ? "cinema" : bucket === "auto" ? "auto" : "video",
      status: "pending",
      prompt: seg2Prompt, // raw prompt — full prompt with locks set in after()
      reference_url: null, // anchor frame URL set in after()
      task_id: null,
      duration: 8,
      cost: 0,
      segment_index: 2,
      parent_history_id: sourceHistoryId,
      frame_anchor: frameAnchor,
      metadata: {
        agent: "extend",
        segment_role: "seg2",
        source_history_id: sourceHistoryId,
        bucket,
        aspectRatio,
        upload_status: "queued",
      },
    })
    .select("id")
    .single();

  if (insErr || !child) {
    return NextResponse.json(
      { error: "Failed to insert seg-2 placeholder", detail: insErr?.message },
      { status: 500 }
    );
  }

  const childId = child.id;

  after(async () => {
    try {
      // 1. Resolve plan rate (extend = +8s = video_8s)
      const cost = await priceFor(user.id, "video_8s");

      // 2. Extract frame from source video (fal, slow)
      const frameRes = await falExtractFrame(sourceVideoUrl, frameAnchor, sourceDuration);
      if (!frameRes.ok || !frameRes.url) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: `Frame extract failed: ${frameRes.error}`,
          metadata: {
            agent: "extend", segment_role: "seg2",
            source_history_id: sourceHistoryId, bucket, aspectRatio,
            upload_status: "failed",
          },
        }).eq("id", childId);
        return;
      }

      // 3. Build seg-2 prompt with all available locks
      const compose: string[] = [seg2Prompt];
      if (characterLock) compose.push(characterLock);

      let productOcr: any = null;
      if (productImageUrl) {
        productOcr = await getCachedProductOcr(user.id, productImageUrl).catch(() => null);
        const lockBlock = productTextLockBlock(productOcr);
        if (lockBlock) compose.push(lockBlock);
      }

      const voiceLine = voiceId ? VOICE_MAP[voiceId] : "";
      const fullPrompt =
        `${compose.join("\n\n").trim()}` +
        (voiceLine ? `\n\nVoice direction: ${voiceLine}` : "") +
        STANDARD_LOCKS;

      // 4. Fire seg-2 Crun task
      const cfg = await getP2Config();
      const model = bucket === "cinema" ? cfg.grokI2V : cfg.videoR2V;
      if (!model) {
        await admin.from("history").update({
          status: "failed",
          cost,
          error_message: "Model not configured",
          metadata: {
            agent: "extend", segment_role: "seg2",
            source_history_id: sourceHistoryId, bucket, aspectRatio,
            upload_status: "failed",
          },
        }).eq("id", childId);
        return;
      }

      const created = await p2CreateTask({
        model,
        prompt: fullPrompt,
        imageUrls: [frameRes.url],
        durationMode: "8",
        aspectRatio,
        imageMode: bucket === "cinema" ? "frame" : "ingredient",
      });

      // 5. Update placeholder with task_id (or fail with upstream error)
      await admin
        .from("history")
        .update({
          status: created.ok && created.task_id ? "pending" : "failed",
          task_id: created.task_id || null,
          cost,
          prompt: fullPrompt,
          reference_url: frameRes.url,
          error_message: created.ok ? null : created.error || "Extend P2 create failed",
          metadata: {
            agent: "extend",
            segment_role: "seg2",
            source_history_id: sourceHistoryId,
            anchor_frame_url: frameRes.url,
            bucket,
            aspectRatio,
            product_ocr: productOcr || null,
            character_lock: characterLock || null,
            voice: voiceId || null,
            voice_line: voiceLine || null,
            upload_status: created.ok ? "done" : "failed",
          },
        })
        .eq("id", childId);
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .eq("id", childId);
    }
  });

  return NextResponse.json({
    ok: true,
    seg2_history_id: childId,
    parent_history_id: sourceHistoryId,
  });
}
