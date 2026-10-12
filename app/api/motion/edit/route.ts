import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, refundReserved, reserveCredit } from "@/lib/deduct";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { MOTION_EDIT_MAX_SEC, costFor, motionStart, newPlanToken, siteUrl, type EditInput } from "@/lib/motion";

// POST /api/motion/edit — Motion "Edit Video": animate the client's own video
// (captions, word-synced stickers, zooms, optional music). The video was
// already uploaded via /api/motion/upload-url. Reserves ceil(duration) × rate,
// starts the Modal job; Modal transcribes, calls /api/motion/plan for the
// overlay plan, renders. settleMotionRow trues up the charge on the real length.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Uploads land on our content bucket via the Modal upload route.
const ALLOWED_VIDEO_HOST = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/motion-uploads\//;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }

  const b = await req.json().catch(() => ({} as any));
  const videoUrl = String(b?.video_url || "");
  if (!ALLOWED_VIDEO_HOST.test(videoUrl)) {
    return NextResponse.json({ error: "Sila upload video dahulu." }, { status: 400 });
  }
  const declared = Number(b?.duration_sec) || 0;
  if (!(declared > 0.5)) return NextResponse.json({ error: "Tempoh video tidak sah." }, { status: 400 });
  const durationSec = Math.min(declared, MOTION_EDIT_MAX_SEC);
  const style = ["pop", "karaoke", "box"].includes(b?.caption_style) ? b.caption_style : "pop";

  const input: EditInput = {
    videoUrl,
    durationSec,
    language: b?.language === "en" ? "en" : b?.language === "auto" ? "auto" : "ms",
    instructions: str(b?.prompt ?? b?.instructions, 900) || undefined,
    product: str(b?.product, 300) || undefined,
    captions: b?.captions !== false,
    captionStyle: style,
    captionPos: b?.caption_pos === "mid" ? "mid" : "low",
    music: !!b?.music,
    sfx: b?.sfx !== false,
    accent: /^#[0-9a-f]{6}$/i.test(String(b?.accent || "")) ? String(b.accent) : undefined,
    style: b?.style === "clean" ? "clean" : "gempak",
    resolution: b?.resolution === "720" ? "720" : "1080",
    jumpcut: b?.jumpcut !== false,
    broll: b?.broll !== false,
    facts: b?.facts !== false,
    guard: b?.guard === true,
  };
  const projectId = b?.project_id ? String(b.project_id) : null;

  const rate = await priceFor(user.id, "motion", "motion");
  const estimate = costFor(durationSec, rate);
  const planToken = newPlanToken();

  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: "motion",
      status: "pending",
      prompt: input.instructions || input.product || "Edit Video",
      reference_url: videoUrl,
      task_id: null,
      cost: estimate,
      duration: Math.round(durationSec),
      metadata: {
        feature: "motion-edit",
        model: "motion",
        stage: "queued",
        rate,
        reserved: estimate,
        input,
        plan_token: planToken,
        aspectRatio: "9:16",
      },
    })
    .select("id")
    .single();
  if (insErr || !hist) {
    return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  }

  const ok = await reserveCredit(user.id, "motion", estimate, hist.id);
  if (!ok) {
    await admin.from("history").delete().eq("id", hist.id);
    return NextResponse.json(
      { error: `Kredit tidak mencukupi — perlu RM${estimate.toFixed(2)} untuk video ${Math.ceil(durationSec)}s.`, needed: estimate },
      { status: 402 }
    );
  }

  const start = await motionStart({
    flow: "edit",
    history_id: hist.id,
    user_id: user.id,
    video_url: videoUrl,
    plan_url: `${siteUrl()}/api/motion/plan`,
    qa_url: `${siteUrl()}/api/motion/qa`,
    guard_url: `${siteUrl()}/api/motion/guard`,
    guard: !!input.guard,
    plan_token: planToken,
    style: input.style,
    resolution: input.resolution,
    jumpcut: input.jumpcut,
    language: input.language,
    music: input.music,
    sfx: input.sfx,
    max_sec: MOTION_EDIT_MAX_SEC,
  });
  if (!start.ok) {
    await admin.from("history").update({ status: "failed", error_message: start.error, cost: 0 }).eq("id", hist.id);
    await refundReserved(user.id, "motion", estimate, hist.id);
    return NextResponse.json({ error: `Gagal mula render: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", hist.id).maybeSingle();
  await admin
    .from("history")
    // "queued" until Modal reports its own stage (shown on the History placeholder)
    .update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), stage: "queued", provider: "modal-motion" } })
    .eq("id", hist.id);

  return NextResponse.json({ ok: true, id: hist.id, estimate, rate });
}
