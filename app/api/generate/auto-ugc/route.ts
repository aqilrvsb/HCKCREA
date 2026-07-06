import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { hasEnoughCredits } from "@/lib/deduct";
import { getP2Config, getGrokRate } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { generateUgcStartFrame } from "@/lib/ugc-startframe";
import { splitDuration, sellerWordTarget } from "@/lib/auto-ugc-segments";

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

const SCENE_LABELS: Record<string, string> = {
  ugc: "UGC realistik",
  "giant-figure": "Giant Figure (produk gergasi)",
  "unbox-tryon": "Unboxing + Virtual Try-On",
  "unbox-asmr": "Unboxing ASMR",
  "tryon-sneakers": "Virtual Try-On",
  addiction: "UGC Addiction (obsesi produk)",
  "before-after": "Before & After",
  tutorial: "Tutorial langkah demi langkah",
  unboxing: "Unboxing",
};

type Plan = {
  topic: string;
  outfit: string;
  segments: { scene: string; dialog: string; videoPrompt: string; imagePrompt: string }[];
};

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
  const productUrls: string[] = Array.isArray(body?.product_image_urls)
    ? body.product_image_urls.filter((u: any) => typeof u === "string" && !!u).slice(0, 3)
    : [];
  const avatarMode: "create" | "existing" = body?.avatar_mode === "existing" ? "existing" : "create";
  const avatarUrl = String(body?.avatar_url || "").trim();
  const gender = body?.avatar_gender === "male" ? "male" : "female";
  const hijab = body?.avatar_hijab === "hijab" ? "hijab" : "no-hijab";
  const age = ["20s", "30s", "40s", "55+"].includes(body?.avatar_age) ? body.avatar_age : "30s";
  const sceneIds: string[] = Array.isArray(body?.scene_ideas)
    ? body.scene_ideas.filter((s: any) => typeof s === "string")
    : [];
  const customIdea = String(body?.custom_idea || "").trim();
  const durationSec = Math.max(4, Math.min(30, Number(body?.duration_sec) || 15));
  const quantity = Math.max(1, Math.min(10, Number(body?.quantity) || 1));
  const aspectRatio = body?.aspect_ratio === "16:9" ? "16:9" : "9:16";
  const ctaMode: "shop" | "custom" | "none" =
    body?.cta_mode === "custom" ? "custom" : body?.cta_mode === "none" ? "none" : "shop";
  const customCta = String(body?.custom_cta || "").trim();
  const projectId = body?.project_id || null;

  // Validation
  if (productUrls.length === 0) {
    return NextResponse.json({ error: "Sekurang-kurangnya satu gambar produk diperlukan." }, { status: 400 });
  }
  if (avatarMode === "existing" && !avatarUrl) {
    return NextResponse.json({ error: "Sila muat naik gambar avatar." }, { status: 400 });
  }
  if (sceneIds.length === 0 && !customIdea) {
    return NextResponse.json({ error: "Pilih sekurang-kurangnya satu idea/scene." }, { status: 400 });
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

  // ── Build the continuous-dialog master script (one LLM call) ──────
  const personaDesc =
    `${gender === "male" ? "lelaki" : "perempuan"} Melayu ${age}` +
    (hijab === "hijab" ? ", bertudung (menutup aurat, pakaian sopan)" : ", tiada tudung");
  const sceneList = sceneIds.map((s) => SCENE_LABELS[s] || s).join(", ") || "UGC realistik";
  const wt0 = sellerWordTarget(segLens[0]);
  const wt1 = segCount > 1 ? sellerWordTarget(segLens[1]) : wt0;
  const ctaInstruction =
    ctaMode === "shop"
      ? "Akhiri segmen TERAKHIR dengan CTA jualan (cth: 'Klik keranjang kuning sekarang!')."
      : ctaMode === "custom"
        ? `Akhiri segmen TERAKHIR dengan CTA ini: "${customCta}".`
        : "Tiada CTA jualan.";

  const systemPrompt = [
    "Anda copywriter UGC TikTok Malaysia. Hasilkan skrip video jualan yang natural, gaya Seller/TikTok (bukan bahasa buku).",
    "PERATURAN AVATAR (WAJIB):",
    `- Avatar (WAJAH) SAMA untuk SEMUA video: ${personaDesc}.`,
    "- Dalam SATU video: baju/outfit SAMA untuk semua segmen; hanya SCENE/situasi berbeza.",
    "- Antara video berlainan: wajah tetap sama, tetapi outfit BOLEH berbeza; topik mesti berbeza.",
    "PERATURAN DIALOG (WAJIB):",
    `- Nada Seller/TikTok, Bahasa Melayu santai. Sasaran perkataan: Seg 1 ~${wt0.min}-${wt0.max} patah` +
      (segCount > 1 ? `, Seg 2 ~${wt1.min}-${wt1.max} patah.` : "."),
    segCount > 1
      ? "- Dialog mesti BERSAMBUNG: Seg 2 menyambung ayat/idea Seg 1 (macam satu take dipotong). Jangan ulang."
      : "- Satu dialog padat untuk satu segmen.",
    `- ${ctaInstruction}`,
    "PERATURAN SCENE:",
    `- Guna konsep ini bila sesuai: ${sceneList}.`,
    customIdea ? `- Idea khusus klien (UTAMAKAN): ${customIdea}` : "",
    "OUTPUT: JSON array sahaja (tiada markdown), tepat " + quantity + " objek video. Setiap video:",
    `{ "topic": "...", "outfit": "...", "segments": [ ${segLens
      .map(
        (s, i) =>
          `{ "scene":"setting/situasi Seg ${i + 1} (berbeza)", "dialog":"dialog Melayu Seg ${i + 1}", ` +
          `"imagePrompt":"deskripsi visual frame permulaan (English) — orang pegang/guna produk, ${aspectRatio}", ` +
          `"videoPrompt":"arahan gerakan + spoken line (English) untuk Grok i2v, ~${s}s, termasuk ayat dialog Melayu" }`
      )
      .join(", ")} ] }`,
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt =
    `Produk: rujuk gambar yang dilampirkan. Hasilkan ${quantity} video UGC ${durationSec}s ` +
    `(${segCount === 1 ? "1 segmen" : `${segCount} segmen: ${segLens.join("s + ")}s`}). ` +
    `Setiap video topik berbeza, avatar sama. Output JSON array sahaja.`;

  let plans: Plan[] = [];
  try {
    const res = await orChat({
      modelKey: "model_custom_idea",
      systemPrompt,
      userPrompt,
      temperature: 0.8,
      maxTokens: Math.max(2000, Math.min(quantity * 900, 20000)),
      logFeature: "auto_only",
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
  const norm: Plan[] = [];
  for (let v = 0; v < quantity; v++) {
    const p = plans[v] || ({} as any);
    const segsIn: any[] = Array.isArray(p.segments) ? p.segments : [];
    const segsOut = segLens.map((_s, i) => {
      const seg = segsIn[i] || segsIn[segsIn.length - 1] || {};
      return {
        scene: String(seg.scene || `${SCENE_LABELS[sceneIds[0]] || "UGC"} scene ${i + 1}`),
        dialog: String(seg.dialog || ""),
        videoPrompt: String(seg.videoPrompt || seg.dialog || "Authentic UGC talking to camera about the product."),
        imagePrompt: String(seg.imagePrompt || "Ultra-realistic UGC frame, person showing the product."),
      };
    });
    norm.push({
      topic: String(p.topic || `UGC ${v + 1}`),
      outfit: String(p.outfit || "smart-casual outfit"),
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
        avatar_persona: personaDesc,
        product_image_urls: productUrls,
        outfit: plan.outfit,
        scene: seg.scene,
        dialog: seg.dialog,
        video_prompt: seg.videoPrompt,
        image_prompt: seg.imagePrompt,
        topic: plan.topic,
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
          caption: plan.topic,
          framework: plan.topic,
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
      let baseAvatarUrl = avatarMode === "existing" ? avatarUrl : "";
      if (avatarMode === "create") {
        const basePrompt = [
          `Ultra-realistic vertical UGC selfie-style photo of a ${personaDesc}.`,
          "They are holding and showing the product from the reference image(s) toward the camera.",
          "Natural indoor lighting, authentic Malaysian micro-influencer look, neutral casual outfit.",
          "The product label must be sharp and match the reference exactly — no warping, no text drift.",
        ].join(" ");
        const base = await generateUgcStartFrame({
          prompt: basePrompt,
          imageUrls: productUrls,
          aspectRatio,
          perTierTimeoutMs: 120_000,
        });
        if (base.ok) baseAvatarUrl = base.url;
        else console.warn("[auto-ugc] base avatar failed, falling back to per-frame persona:", base.error);
      }

      await mapLimit(jobs, 4, async (job) => {
        try {
          const refs = [baseAvatarUrl, ...productUrls].filter((u) => !!u);
          const framePrompt = baseAvatarUrl
            ? [
                "Photorealistic vertical UGC frame.",
                "The person is the SAME identity as the FIRST reference image (identical face, hair, features).",
                `They are wearing: ${job.outfit}.`,
                `Scene / setting: ${job.scene}.`,
                "They are using/showing the product from the other reference image(s); product label sharp and matching exactly.",
                job.imagePrompt,
              ].join(" ")
            : [
                `Photorealistic vertical UGC frame of a ${personaDesc}.`,
                `Wearing: ${job.outfit}.`,
                `Scene / setting: ${job.scene}.`,
                "Using/showing the product from the reference image(s); product label sharp and matching exactly.",
                job.imagePrompt,
              ].join(" ");

          const frame = await generateUgcStartFrame({
            prompt: framePrompt,
            imageUrls: refs,
            aspectRatio,
            perTierTimeoutMs: 120_000,
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
            return;
          }

          const videoPrompt = job.dialog
            ? `${job.videoPrompt}\nSpoken dialog (Malay): "${job.dialog}"`
            : job.videoPrompt;

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
        } catch (e: any) {
          await admin
            .from("history")
            .update({ status: "failed", error_message: e?.message || "Auto UGC background error" })
            .eq("id", job.rowId);
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
