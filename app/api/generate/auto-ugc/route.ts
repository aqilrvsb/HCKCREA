import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat, orChatVision } from "@/lib/openrouter";
import { hasEnoughCredits } from "@/lib/deduct";
import { getP2Config, getGrokRate } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { generateUgcStartFrame } from "@/lib/ugc-startframe";
import { splitDuration } from "@/lib/auto-ugc-segments";
import { buildAutoUgcMasterPlan, type UgcPlan } from "@/lib/auto-ugc-master-plan";
import { FRAMEWORKS } from "@/lib/auto-content-frameworks";

// Auto UGC — restricted (nl@/admin@ only). Grok-Imagine avatar UGC:
//   • duration ≤15s → 1 clip; 16–30s → 2 balanced segments (Seg 1 + Seg 2)
//   • each segment gets a Banana Pro 2 start frame (same avatar + outfit
//     within a video, different scene per segment) then fires Grok i2v
//   • dialog is one continuous Seller/TikTok script split across segments
//   • quantity N → N videos, same avatar (face), outfit may vary per video
//
// The heavy work (base avatar → per-segment start frames → Grok fires) runs
// in after() so the request returns fast. Rows are stamped so the existing
// event-driven settle + auto-resubmit cron recover them through the GROK
// cascade pool, and history-grid renders Seg 1/Seg 2 as one no-merge card.

export const maxDuration = 300;

const AUTO_UGC_EMAILS = ["nl@gmail.com", "admin@gmail.com"];

// Bounded-concurrency map so we don't fan out dozens of Banana polls at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = (user.email || "").trim().toLowerCase();
  if (!AUTO_UGC_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Auto UGC tidak tersedia untuk akaun ini." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Body shape = the duplicated Auto Content tab, plus Auto UGC's extra
  // fields (avatar_mode / avatar_url / duration_sec). Product images come
  // from manual_products[].imageUrls (+ product_image_url fallback).
  const manualProducts: any[] = Array.isArray(body?.manual_products) ? body.manual_products : [];
  const productUrls: string[] = [
    ...manualProducts.flatMap((p: any) => (Array.isArray(p?.imageUrls) ? p.imageUrls : [])),
    body?.product_image_url,
  ]
    .filter((u: any) => typeof u === "string" && !!u)
    .filter((u, i, a) => a.indexOf(u) === i)
    .slice(0, 3);
  const productName = String(body?.product_name || manualProducts?.[0]?.info?.split("\n")[0] || "").trim();
  const productDetail = String(body?.product_detail || manualProducts?.[0]?.info || "").trim();
  const avatarMode: "create" | "existing" = body?.avatar_mode === "existing" ? "existing" : "create";
  const avatarUrl = String(body?.avatar_url || "").trim();
  // Avatar Kekal (default) = one face across the whole batch. Avatar
  // Dynamic = a different face per video (same gender/style/age criteria).
  // Existing-avatar mode is inherently kekal.
  const avatarConsistency: "kekal" | "dynamic" =
    avatarMode === "create" && body?.avatar_consistency === "dynamic" ? "dynamic" : "kekal";
  const gender = body?.avatar_gender === "male" ? "male" : "female";
  const hijab = body?.avatar_hijab === "hijab" ? "hijab" : "no-hijab";
  const age = ["20s", "30s", "40s", "55+"].includes(body?.avatar_age) ? body.avatar_age : "30s";
  // Framework selection is INTERNAL — the AI picks one UGC framework per
  // video from the full UGC bank (frameworks UI removed per user direction).
  const frameworkNames = FRAMEWORKS.filter((f) => f.type === "ugc").map(
    (f) => `${f.name} (${f.focus})`
  );
  const customIdea = String(body?.idea_style || body?.custom_idea || "").trim();
  const durationSec = Math.max(4, Math.min(30, Number(body?.duration_sec) || 15));
  const quantity = Math.max(1, Math.min(10, Number(body?.quantity) || 1));
  const aspectRatio = body?.aspect_ratio === "16:9" ? "16:9" : "9:16";
  const ctaMode: "shop" | "custom" | "none" =
    body?.cta_mode === "custom" ? "custom" : body?.cta_mode === "none" ? "none" : "shop";
  const customCta = String(body?.custom_cta || "").trim();
  const projectId = body?.project_id || null;
  const sceneList = frameworkNames.length > 0 ? frameworkNames.join(", ") : "UGC realistik, testimoni jujur, before & after";

  // Validation
  if (productUrls.length === 0) {
    return NextResponse.json({ error: "Sekurang-kurangnya satu gambar produk diperlukan." }, { status: 400 });
  }
  if (avatarMode === "existing" && !avatarUrl) {
    return NextResponse.json({ error: "Sila muat naik gambar avatar." }, { status: 400 });
  }

  const segLens = splitDuration(durationSec);
  const segCount = segLens.length;
  const totalSegments = quantity * segCount;

  // Pricing — one Grok clip per segment, priced per-second. Banana start
  // frames are bundled (never separately billed). Deduction happens on
  // settle when each Grok task completes.
  const grokRate = await getGrokRate();
  const costPerVideo = grokRate * durationSec; // sum of the video's segment lengths
  const totalCost = costPerVideo * quantity;
  const ok = await hasEnoughCredits(user.id, totalCost);
  if (!ok) {
    const admin = createAdminClient();
    const { data: p } = await admin.from("profiles").select("credits").eq("id", user.id).maybeSingle();
    return NextResponse.json(
      { error: "Kredit tidak mencukupi", balance: Number(p?.credits ?? 0), needed: totalCost },
      { status: 402 }
    );
  }

  const personaDesc =
    `${gender === "male" ? "lelaki" : "perempuan"} Melayu ${age}` +
    (hijab === "hijab" ? ", bertudung (menutup aurat, pakaian sopan)" : ", tiada tudung");

  // ── Product OCR (best-effort) — read the label off the product photo
  // and fold it into the master-plan product data (mirrors Auto Content).
  let ocrText = "";
  try {
    const ocr = await orChatVision({
      modelKey: "model_product_ocr",
      systemPrompt:
        "You are a product label reader. Output ONLY valid JSON. Keys: main_text, subtitle, logo_description, package_color. Empty string if unknown.",
      textPrompt:
        'Read the product packaging. Return JSON only: {"main_text":"","subtitle":"","logo_description":"","package_color":""}.',
      images: [productUrls[0]],
      temperature: 0.1,
      maxTokens: 400,
    });
    if (ocr.ok && ocr.content) {
      const s = ocr.content.indexOf("{");
      const e = ocr.content.lastIndexOf("}");
      if (s >= 0 && e > s) {
        const parsed = JSON.parse(ocr.content.substring(s, e + 1));
        ocrText = [parsed.main_text, parsed.subtitle, parsed.logo_description, parsed.package_color]
          .filter(Boolean)
          .join(" · ");
      }
    }
  } catch {
    // OCR is best-effort — the manual Detail Product field is the primary source.
  }

  // ── Master plan (ported from Auto Content, twisted for Grok) ──────
  const { systemPrompt, userPrompt } = buildAutoUgcMasterPlan({
    quantity,
    segLens,
    gender,
    hijabMode: hijab === "hijab",
    age,
    avatarMode,
    avatarConsistency,
    sceneList,
    customIdea,
    ctaMode,
    customCta,
    product: { name: productName, detail: productDetail, ocr: ocrText },
    aspectRatio,
  });

  let plans: UgcPlan[] = [];
  try {
    const res = await orChat({
      modelKey: "model_custom_idea",
      systemPrompt,
      userPrompt,
      temperature: 0.8,
      maxTokens: Math.max(3000, Math.min(quantity * 1100, 28000)),
      logFeature: customIdea ? "auto_with_idea" : "auto_only",
      logUserId: user.id,
    });
    if (res.ok && res.content) {
      let txt = res.content.trim();
      const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) txt = fence[1].trim();
      const start = txt.indexOf("[");
      const end = txt.lastIndexOf("]");
      if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) plans = parsed;
    }
  } catch (e: any) {
    console.warn("[auto-ugc] script parse failed:", e?.message);
  }

  // Normalise to exactly `quantity` plans × `segCount` segments.
  const norm: UgcPlan[] = [];
  for (let v = 0; v < quantity; v++) {
    const p = (plans[v] || {}) as any;
    const segsIn: any[] = Array.isArray(p.segments) ? p.segments : [];
    const segsOut = segLens.map((_s, i) => {
      const seg = segsIn[i] || segsIn[segsIn.length - 1] || {};
      return {
        scene: String(seg.scene || `UGC scene ${i + 1}`),
        dialog: String(seg.dialog || ""),
        videoPrompt: String(seg.videoPrompt || seg.dialog || "Authentic UGC talking to camera about the product."),
        imagePrompt: String(seg.imagePrompt || "Ultra-realistic UGC frame, person showing the product."),
      };
    });
    norm.push({
      topic: String(p.topic || `UGC ${v + 1}`),
      framework: String(p.framework || ""),
      targetEmotion: String(p.targetEmotion || ""),
      hookAngle: String(p.hookAngle || ""),
      outfit: String(p.outfit || "smart-casual outfit"),
      caption: String(p.caption || ""),
      coverTitle: String(p.coverTitle || ""),
      coverSubtitle: String(p.coverSubtitle || ""),
      segments: segsOut,
    });
  }

  const cfg = await getP2Config();
  const grokModel = cfg.grokI2V || "grok";
  const admin = createAdminClient();

  // ── Insert placeholder rows (Seg 1 parent + Seg 2… children) ──────
  type Job = {
    rowId: string;
    videoIdx: number;
    segIdx: number;
    segLen: number;
    outfit: string;
    scene: string;
    dialog: string;
    videoPrompt: string;
    imagePrompt: string;
  };
  const jobs: Job[] = [];

  for (let v = 0; v < quantity; v++) {
    const plan = norm[v];
    let parentId: string | null = null;
    for (let s = 0; s < segCount; s++) {
      const seg = plan.segments[s];
      const segLen = segLens[s];
      const isChild = s > 0;
      const baseMeta: Record<string, any> = {
        agent: isChild ? "extend" : "auto-ugc",
        modelChoice: "grok",
        model: grokModel,
        provider: "p6",
        imageMode: "frame",
        aspectRatio,
        avatar_mode: avatarMode,
        avatar_consistency: avatarConsistency,
        avatar_persona: personaDesc,
        product_image_urls: productUrls,
        outfit: plan.outfit,
        scene: seg.scene,
        dialog: seg.dialog,
        video_prompt: seg.videoPrompt,
        image_prompt: seg.imagePrompt,
        topic: plan.topic,
        framework: plan.framework || plan.topic,
        target_emotion: plan.targetEmotion,
        hook_angle: plan.hookAngle,
        cover_title: plan.coverTitle,
        cover_subtitle: plan.coverSubtitle,
        seg_index: s + 1,
        seg_count: segCount,
        video_index: v + 1,
        ugc_phase: "startframe_pending",
      };
      const ins = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto-ugc",
          status: "pending",
          prompt: seg.videoPrompt,
          caption: plan.caption || plan.topic,
          framework: plan.framework || plan.topic,
          reference_url: null,
          task_id: null,
          duration: segLen,
          cost: grokRate * segLen,
          parent_history_id: isChild ? parentId : null,
          segment_index: segCount > 1 ? s + 1 : null,
          metadata: baseMeta,
        })
        .select("id")
        .single();
      const row = ins.data as { id: string } | null;
      if (ins.error || !row) {
        console.error("[auto-ugc] row insert failed:", ins.error?.message);
        continue;
      }
      if (!isChild) parentId = row.id;
      jobs.push({
        rowId: row.id,
        videoIdx: v,
        segIdx: s,
        segLen,
        outfit: plan.outfit,
        scene: seg.scene,
        dialog: seg.dialog,
        videoPrompt: seg.videoPrompt,
        imagePrompt: seg.imagePrompt,
      });
    }
  }

  if (jobs.length === 0) {
    return NextResponse.json({ error: "Gagal mencipta baris sejarah." }, { status: 500 });
  }

  // ── Background: base avatar → per-segment start frames → Grok fires ─
  after(async () => {
    try {
      // Resolve the locked avatar (face reference used by every start frame).
      // create+KEKAL: generate ONE base avatar+product image first so every
      // segment of every video references the SAME face.
      // create+DYNAMIC: skip the global base — each video's Seg 1 frame is
      // generated fresh from the persona (different face per video); Seg 2
      // still anchors on Seg 1's frame so the face stays consistent WITHIN
      // the video.
      let baseAvatarUrl = avatarMode === "existing" ? avatarUrl : "";
      if (avatarMode === "create" && avatarConsistency === "kekal") {
        const basePrompt = [
          `Ultra-realistic vertical UGC selfie-style photo of a ${personaDesc}.`,
          // Face is DYNAMIC — Banana invents a fresh, specific face per batch
          // (no hardcoded template) so avatars vary between batches.
          "Invent a UNIQUE specific attractive Malaysian face: pick ONE face shape (oval / round / square / heart / long / diamond), realistic natural makeup with concrete details, a specific Malaysian skin tone (fair / medium / sawo matang), and 1-2 distinct features (dimples, monolid or double eyelid, small beauty mark). Never a generic AI-template face.",
          "They are holding and showing the product toward the camera.",
          "Natural indoor lighting, authentic Malaysian micro-influencer look, neutral casual outfit.",
          "PRODUCT REFERENCE (the attached product image) = the exact colour, label, typography, shape and packaging ONLY — copy it pixel-identically, ignore its own background/scene. No warping, no recolour, no text drift.",
        ].join(" ");
        const base = await generateUgcStartFrame({
          prompt: basePrompt,
          imageUrls: productUrls,
          aspectRatio,
          // Shorter tier budget — the whole after() window is 300s; a slow
          // base avatar must not starve the per-segment frames + Grok fires.
          perTierTimeoutMs: 90_000,
        });
        if (base.ok) {
          baseAvatarUrl = base.url;
          // Persist onto every row so the auto-ugc-recover worker can anchor
          // seg-1 frames if this after() dies before firing them.
          for (const j of jobs) {
            await admin
              .from("history")
              .update({ metadata: await mergeMeta(admin, j.rowId, { base_avatar_url: base.url }) })
              .eq("id", j.rowId);
          }
        } else {
          console.warn("[auto-ugc] base avatar failed, falling back to per-frame persona:", base.error);
        }
      }

      // One segment: Banana start-frame → Grok i2v. Returns the frame URL
      // so the NEXT segment of the same video can reference it (same scene,
      // new camera angle). `seg1FrameUrl` is empty for Seg 1.
      const processJob = async (job: Job, seg1FrameUrl: string): Promise<string | null> => {
        try {
          // Reference role-split (v16): IMAGE 1 = identity/scene anchor,
          // LAST image(s) = product = colour/label/shape reference ONLY.
          // Seg 2 anchors on Seg 1's START FRAME so both frames are the
          // SAME scene — only the camera angle changes (angle_cut_rules).
          const anchorUrl = seg1FrameUrl || baseAvatarUrl;
          const refs = [anchorUrl, ...productUrls].filter((u) => !!u);
          const roleSplit = seg1FrameUrl
            ? `THE ONLY CHANGE IS THE CAMERA ANGLE — re-shoot IMAGE 1's exact moment from this new angle: ${job.scene}. IMAGE 1 = Segment 1's start frame — keep the SAME person, SAME outfit, SAME room, SAME lighting, SAME product placement; change NOTHING except the camera angle. LAST reference image = the PRODUCT = its exact colour, label, typography, shape ONLY — keep it pixel-identical and clearly VISIBLE.`
            : anchorUrl
              ? "IMAGE 1 = the person's identity (keep the EXACT same face, hair, features). LAST reference image = the PRODUCT = its exact colour, label, typography, shape ONLY — copy pixel-identically, ignore the product image's own background/scene. The product must be clearly VISIBLE in the frame (in hand, label toward camera, or worn)."
              : "The reference image is the PRODUCT = its exact colour, label, typography, shape ONLY — copy pixel-identically, ignore its own background/scene. The product must be clearly VISIBLE in the frame.";
          const framePrompt = [
            job.imagePrompt,
            anchorUrl ? `Outfit (locked for this video): ${job.outfit}. Scene: ${job.scene}.` : `${personaDesc}. Outfit (locked for this video): ${job.outfit}. Scene: ${job.scene}.`,
            roleSplit,
            // Code-level anatomy lock — the avatar is TALKING to camera, so
            // overhead/behind/profile angles produce grotesque results.
            "Anatomically perfect: two hands, five fingers each, natural neck and upright posture, the person's face level and clearly toward the camera (never top-of-head view, never craned neck, never from behind).",
            `Photorealistic vertical UGC start frame, ${aspectRatio}, soft natural lighting, shallow depth of field.`,
          ].join(" ");

          const frame = await generateUgcStartFrame({
            prompt: framePrompt,
            imageUrls: refs,
            aspectRatio,
            perTierTimeoutMs: 90_000,
          });
          if (!frame.ok) {
            await admin
              .from("history")
              .update({
                status: "failed",
                error_message: `Start-frame gagal: ${frame.error}`,
                metadata: await mergeMeta(admin, job.rowId, { ugc_phase: "startframe_failed", startframe_tier_log: frame.tierLog }),
              })
              .eq("id", job.rowId);
            return null;
          }

          const videoPrompt =
            (job.dialog
              ? `${job.videoPrompt}\nSpoken dialog (Malay): "${job.dialog}"`
              : job.videoPrompt) +
            "\nAnatomically perfect: two hands, five fingers each, natural neck and upright posture, face level and toward the camera throughout. No head-spinning, no body warping, no extra limbs.";

          const result = await generateVideoWithCascade({
            primaryModel: grokModel,
            prompt: videoPrompt,
            userId: user.id,
            imageUrls: [frame.url],
            durationMode: String(job.segLen),
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
                metadata: await mergeMeta(admin, job.rowId, {
                  ugc_phase: "grok_firing",
                  image_urls: [frame.url],
                  startframe_url: frame.url,
                  startframe_provider: frame.provider,
                  model: result.actualModel || grokModel,
                  provider: result.actualProvider,
                  slot: result.actualSlot,
                  fallback_used: result.fallbackUsed,
                }),
              })
              .eq("id", job.rowId);
          } else {
            await admin
              .from("history")
              .update({
                status: "failed",
                reference_url: frame.url,
                error_message: result.error,
                metadata: await mergeMeta(admin, job.rowId, {
                  ugc_phase: "grok_failed",
                  image_urls: [frame.url],
                  startframe_url: frame.url,
                  tier_log: result.tierLog,
                }),
              })
              .eq("id", job.rowId);
          }
          return frame.url;
        } catch (e: any) {
          await admin
            .from("history")
            .update({ status: "failed", error_message: e?.message || "Auto UGC background error" })
            .eq("id", job.rowId);
          return null;
        }
      };

      // Group segments by video — videos run in parallel (capped), but the
      // segments WITHIN a video run sequentially so Seg 2's start frame can
      // anchor on Seg 1's start frame (same scene, new angle).
      const byVideo = new Map<number, Job[]>();
      for (const j of jobs) {
        const arr = byVideo.get(j.videoIdx) || [];
        arr.push(j);
        byVideo.set(j.videoIdx, arr);
      }
      const videoGroups = Array.from(byVideo.values()).map((arr) =>
        arr.sort((a, b) => a.segIdx - b.segIdx)
      );
      await mapLimit(videoGroups, 3, async (group) => {
        let seg1FrameUrl = "";
        for (const job of group) {
          const url = await processJob(job, job.segIdx > 0 ? seg1FrameUrl : "");
          if (job.segIdx === 0 && url) seg1FrameUrl = url;
        }
      });
    } catch (e: any) {
      console.error("[auto-ugc] after() fatal:", e?.message);
    }
  });

  return NextResponse.json({
    ok: true,
    quantity,
    segments_total: totalSegments,
    segments_per_video: segCount,
    total_cost: totalCost,
  });
}

// Merge new fields into a row's existing metadata without clobbering the
// concurrently-written keys. Reads current metadata then returns the merged
// object for the caller to write in the same update.
async function mergeMeta(
  admin: ReturnType<typeof createAdminClient>,
  rowId: string,
  patch: Record<string, any>
): Promise<Record<string, any>> {
  const { data } = await admin.from("history").select("metadata").eq("id", rowId).maybeSingle();
  const cur = (data?.metadata as Record<string, any>) || {};
  return { ...cur, ...patch };
}
