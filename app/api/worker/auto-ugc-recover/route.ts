import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUgcStartFrame } from "@/lib/ugc-startframe";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getP2Config } from "@/lib/settings";

// GET /api/worker/auto-ugc-recover — rescues Auto UGC rows whose start-frame
// pipeline died before the Grok task fired.
//
// Why this exists: /api/generate/auto-ugc does its heavy work (base avatar →
// per-segment Banana start frames → Grok i2v fires) inside after(), which
// Vercel kills at maxDuration. If the image cascade is slow that day, the
// window can close before some/all segments fire — leaving rows stuck at
// status='pending', task_id=null, metadata.ugc_phase='startframe_pending'
// forever (the auto-resubmit cron only scans status='failed', and the
// poll-pending worker needs a task_id). This worker picks those rows up and
// finishes the job: regenerate the start frame → fire Grok → stamp task_id.
//
// Anchor rules (mirrors the generate route):
//   • seg 1 → metadata.base_avatar_url (persisted by the route when the
//     batch base avatar succeeded) else persona-text fallback.
//   • seg 2+ → the PARENT row's start frame (reference_url /
//     metadata.startframe_url) so the angle-cut stays on the same scene.
//     If the parent hasn't fired yet, the child is skipped this tick and
//     picked up after the parent recovers. If the parent FAILED, the child
//     is failed too (it cannot anchor).
//
// Attempts are capped (2) via metadata.startframe_attempts — after that the
// row is marked failed so the user sees it and can resubmit manually.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STUCK_AFTER_MS = 5 * 60_000; // give the origin after() its full window
const MAX_ROWS_PER_TICK = 6;
const MAX_ATTEMPTS = 2;

const ANATOMY_LOCK_IMG =
  "Anatomically perfect: two hands, five fingers each, natural neck and upright posture, the person's face level and clearly toward the camera (never top-of-head view, never craned neck, never from behind).";
const ANATOMY_LOCK_VID =
  "Anatomically perfect: two hands, five fingers each, natural neck and upright posture, face level and toward the camera throughout. No head-spinning, no body warping, no extra limbs.";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

  const { data: stuck, error: qErr } = await admin
    .from("history")
    .select(
      "id, user_id, status, duration, segment_index, parent_history_id, reference_url, metadata, created_at"
    )
    .eq("tab", "auto-ugc")
    .eq("status", "pending")
    .is("task_id", null)
    .lt("created_at", cutoff)
    .order("segment_index", { ascending: true })
    .limit(MAX_ROWS_PER_TICK);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }
  const summary = { scanned: stuck?.length || 0, fired: 0, failed: 0, skipped: 0 };
  if (!stuck || stuck.length === 0) return NextResponse.json({ ok: true, ...summary });

  const cfg = await getP2Config();
  const grokModel = cfg.grokI2V || "grok";

  for (const row of stuck) {
    const meta = (row.metadata as Record<string, any>) || {};
    const attempts = Number(meta.startframe_attempts || 0);

    // Cap attempts → surface as failed so the user can act.
    if (attempts >= MAX_ATTEMPTS) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: "Start-frame recovery exhausted — sila resubmit.",
          metadata: { ...meta, ugc_phase: "startframe_failed" },
        })
        .eq("id", row.id)
        .eq("status", "pending");
      summary.failed += 1;
      continue;
    }

    // Resolve the anchor image.
    let anchorUrl = "";
    const isChild = !!row.parent_history_id && (row.segment_index ?? 1) > 1;
    if (isChild) {
      const { data: parent } = await admin
        .from("history")
        .select("status, reference_url, metadata")
        .eq("id", row.parent_history_id)
        .maybeSingle();
      const pMeta = (parent?.metadata as Record<string, any>) || {};
      anchorUrl = parent?.reference_url || pMeta.startframe_url || "";
      if (!anchorUrl) {
        if (parent?.status === "failed") {
          // Parent can never provide an anchor — fail the child too.
          await admin
            .from("history")
            .update({
              status: "failed",
              error_message: "Seg 1 gagal — resubmit Seg 1 dahulu.",
              metadata: { ...meta, ugc_phase: "startframe_failed" },
            })
            .eq("id", row.id)
            .eq("status", "pending");
          summary.failed += 1;
        } else {
          summary.skipped += 1; // parent not fired yet — next tick
        }
        continue;
      }
    } else {
      anchorUrl = meta.base_avatar_url || "";
    }

    // Claim (bump attempts) before the slow work so a concurrent tick skips it.
    const { data: claimed } = await admin
      .from("history")
      .update({
        metadata: {
          ...meta,
          startframe_attempts: attempts + 1,
          ugc_phase: "startframe_retry",
          recover_claimed_at: new Date().toISOString(),
        },
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .is("task_id", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const productUrls: string[] = Array.isArray(meta.product_image_urls)
      ? meta.product_image_urls.filter((u: any) => typeof u === "string" && !!u)
      : [];
    const aspectRatio = String(meta.aspectRatio || "9:16");
    const personaDesc = String(meta.avatar_persona || "perempuan Melayu 30s");

    const roleSplit = isChild
      ? `THE ONLY CHANGE IS THE CAMERA ANGLE — re-shoot IMAGE 1's exact moment from this new angle: ${meta.scene || "a new natural talking-head angle"}. IMAGE 1 = Segment 1's start frame — keep the SAME person, SAME outfit, SAME room, SAME lighting, SAME product placement; change NOTHING except the camera angle. LAST reference image = the PRODUCT = its exact colour, label, typography, shape ONLY — keep it pixel-identical and clearly VISIBLE.`
      : anchorUrl
        ? "IMAGE 1 = the person's identity (keep the EXACT same face, hair, features). LAST reference image = the PRODUCT = its exact colour, label, typography, shape ONLY — copy pixel-identically, ignore the product image's own background/scene. The product must be clearly VISIBLE in the frame (in hand, label toward camera, or worn)."
        : "The reference image is the PRODUCT = its exact colour, label, typography, shape ONLY — copy pixel-identically, ignore its own background/scene. The product must be clearly VISIBLE in the frame.";

    const framePrompt = [
      String(meta.image_prompt || "Ultra-realistic UGC frame, person showing the product."),
      anchorUrl
        ? `Outfit (locked for this video): ${meta.outfit || ""}. Scene: ${meta.scene || ""}.`
        : `${personaDesc}. Outfit (locked for this video): ${meta.outfit || ""}. Scene: ${meta.scene || ""}.`,
      roleSplit,
      ANATOMY_LOCK_IMG,
      `Photorealistic vertical UGC start frame, ${aspectRatio}, soft natural lighting, shallow depth of field.`,
    ].join(" ");

    try {
      const frame = await generateUgcStartFrame({
        prompt: framePrompt,
        imageUrls: [anchorUrl, ...productUrls].filter((u) => !!u),
        aspectRatio,
        perTierTimeoutMs: 90_000,
      });
      if (!frame.ok) {
        await admin
          .from("history")
          .update({
            status: attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
            error_message:
              attempts + 1 >= MAX_ATTEMPTS ? `Start-frame gagal: ${frame.error}` : null,
            metadata: {
              ...meta,
              startframe_attempts: attempts + 1,
              ugc_phase:
                attempts + 1 >= MAX_ATTEMPTS ? "startframe_failed" : "startframe_pending",
              startframe_tier_log: frame.tierLog,
            },
          })
          .eq("id", row.id);
        summary.failed += 1;
        continue;
      }

      const videoPrompt =
        (meta.dialog
          ? `${meta.video_prompt || ""}\nSpoken dialog (Malay): "${meta.dialog}"`
          : String(meta.video_prompt || "")) +
        "\n" +
        ANATOMY_LOCK_VID;

      const result = await generateVideoWithCascade({
        primaryModel: grokModel,
        prompt: videoPrompt,
        userId: row.user_id,
        imageUrls: [frame.url],
        durationMode: String(row.duration || 15),
        aspectRatio,
        imageMode: "frame",
        asset: "grok",
      });

      if (result.ok) {
        await admin
          .from("history")
          .update({
            task_id: result.taskId,
            reference_url: frame.url,
            status: "pending",
            error_message: null,
            metadata: {
              ...meta,
              startframe_attempts: attempts + 1,
              ugc_phase: "grok_firing",
              image_urls: [frame.url],
              startframe_url: frame.url,
              startframe_provider: frame.provider,
              model: result.actualModel || grokModel,
              provider: result.actualProvider,
              slot: result.actualSlot,
              fallback_used: result.fallbackUsed,
              recovered_by: "auto-ugc-recover",
            },
          })
          .eq("id", row.id);
        summary.fired += 1;
      } else {
        await admin
          .from("history")
          .update({
            status: "failed",
            reference_url: frame.url,
            error_message: result.error,
            metadata: {
              ...meta,
              startframe_attempts: attempts + 1,
              ugc_phase: "grok_failed",
              image_urls: [frame.url],
              startframe_url: frame.url,
              tier_log: result.tierLog,
            },
          })
          .eq("id", row.id);
        summary.failed += 1;
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
          error_message: attempts + 1 >= MAX_ATTEMPTS ? e?.message || "Recovery error" : null,
          metadata: {
            ...meta,
            startframe_attempts: attempts + 1,
            ugc_phase:
              attempts + 1 >= MAX_ATTEMPTS ? "startframe_failed" : "startframe_pending",
          },
        })
        .eq("id", row.id);
      summary.failed += 1;
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
