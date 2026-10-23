import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, refundReserved, reserveCredit } from "@/lib/deduct";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { MOTION_EDIT_MAX_SEC, allowedEngine, costFor, motionStart, newPlanToken, round2, siteUrl, type EditInput } from "@/lib/motion";
import { isMotionStyle, styleEnergy } from "@/lib/motion-styles";
import { cleanLocks } from "@/lib/motion-manual";
import { padatMin } from "@/lib/motion-padat";
import { vgcStyle } from "@/lib/vgc-styles";

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
  const style = ["pop", "karaoke", "box", "tiktok"].includes(b?.caption_style) ? b.caption_style : "pop";

  // Required: the seller's own product photos (1–5, uploaded via /api/upload/image)
  // — every product B-roll shot comes from these, never another brand's box.
  const productImages = (Array.isArray(b?.product_images) ? b.product_images : [])
    .map((u: unknown) => String(u ?? "").trim())
    .filter((u: string) => /^https:\/\/[^\s]+$/.test(u) && u.length <= 1000)
    .slice(0, 5);
  if (productImages.length === 0) {
    return NextResponse.json({ error: "Upload sekurang-kurangnya 1 gambar produk." }, { status: 400 });
  }
  // Required: the product name as it should be spelt — the director, the
  // caption fixer and the transcriber all use it.
  const product = str(b?.product, 80);
  if (!product) return NextResponse.json({ error: "Sila isi nama produk." }, { status: 400 });

  // AI Auto: the director picks angle, look, colour, captions, hook sound and
  // music from the video itself. "Saya nak pilih sendiri" sends `locks`: the same AI Auto brain plans the edit and
  // every pick is a rule it must follow (lib/motion-manual.ts) — unset picks stay the AI's call.
  const locks = cleanLocks(b?.locks);
  const manual = !!locks;
  // one of the 40 styles: its brief directs the edit (the director reads it from the library — lib/vgc-styles.ts)
  if (locks?.styleId) {
    const st = await vgcStyle(locks.styleId);
    if (!st) return NextResponse.json({ error: "Style tidak dijumpai — pilih semula." }, { status: 400 });
    locks.styleName = st.name;
  }
  const auto = b?.auto === true || manual;
  // 2-step flow (mandatory): stop after the script + captions so the client
  // reviews them ("Jana Video" on the History card renders — /api/motion/render)
  const review = true;
  const input: EditInput = {
    videoUrl,
    ...(["bag", "live", "none"].includes(b?.cta_kind) ? { ctaKind: b.cta_kind as "bag" | "live" | "none" } : {}),
    durationSec,
    language: b?.language === "en" ? "en" : b?.language === "auto" ? "auto" : "ms",
    instructions: auto && !manual ? undefined : str(b?.prompt ?? b?.instructions, 900) || undefined,
    product,
    productImages,
    captions: b?.captions !== false, // the one choice AI Auto leaves to the client
    captionStyle: manual ? (locks.captionLook === "tiktok" ? "tiktok" : "pop") : auto ? "pop" : style,
    captionPos: manual ? locks.captionPos ?? "low" : auto ? "low" : b?.caption_pos === "mid" ? "mid" : "low",
    // AI Auto: Modal takes music from the plan (a manual lock is written into the plan)
    music: manual ? locks.music === true : auto ? false : !!b?.music,
    sfx: manual ? b?.sfx !== false : auto || b?.sfx !== false,
    accent: (!auto || manual) && /^#[0-9a-f]{6}$/i.test(String(b?.accent || "")) ? String(b.accent) : undefined,
    style: manual ? locks.look ?? "gempak" : !auto && isMotionStyle(b?.style) ? b.style : "gempak",
    resolution: b?.resolution === "720" ? "720" : "1080",
    jumpcut: b?.jumpcut !== false,
    broll: b?.broll !== false,
    facts: b?.facts !== false,
    guard: b?.guard === true,
    ...(auto ? { auto: true } : {}),
    ...(manual ? { locks } : {}),
    // "laju" = the templates; "padat" = step 2 built by Claude Code on HyperFrames (hidden from clients
    // unless app_settings.motion_padat is on — a hidden Padat request runs as Laju)
    engine: await allowedEngine(b?.engine, user.id),
  };
  const projectId = b?.project_id ? String(b.project_id) : null;

  const rate = await priceFor(user.id, "motion", "motion");
  // Padat costs at least the Custom Style video price (held now, trued up at the end)
  const minCost = input.engine === "padat" ? await padatMin(rate) : 0;
  const estimate = round2(Math.max(costFor(durationSec, rate), minCost));
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
        ...(review ? { review: true } : {}),
        ...(minCost > 0 ? { padat_min: minCost } : {}),
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
    style: styleEnergy(input.style), // render energy of the chosen look
    look: input.style,
    resolution: input.resolution,
    jumpcut: input.jumpcut,
    language: input.language,
    // Whisper prompt: brand / product spelling (e.g. "Gluvera") for the captions
    hint: input.product?.slice(0, 120),
    music: input.music,
    sfx: input.sfx,
    max_sec: MOTION_EDIT_MAX_SEC,
    // AI Auto: Modal takes energy, music and the hook sound from the plan
    auto: !!input.auto,
    // step 1 fixes the caption spelling only when the captions are on
    captions: input.captions,
    ...(review ? { phase: "draft" } : {}),
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
