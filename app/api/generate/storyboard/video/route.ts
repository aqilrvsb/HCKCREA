import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { getGeminiRate, getSeedanceRate } from "@/lib/settings";
import { hasEnoughCredits } from "@/lib/deduct";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/generate/storyboard/video  { history_id }
//
// "Generate Video" from a finished storyboard card. Sends the storyboard grid
// (image 1) + the product photo (image 2) to Omni (gemini, 10s, ingredient)
// with a FIXED role-split prefix and a DYNAMIC creative-direction line written
// per the storyboard's sub-style + product. The video lands in the Original
// Video history grid.

const mainLabelOf = (m: string) => (m === "pc" ? "Product Commercial (polished, cinematic)" : "UGC (realistic, TikTok/Reels)");

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  if (!historyId) return NextResponse.json({ error: "history_id diperlukan" }, { status: 400 });
  // Provider picked in the storyboard "Generate Video" popup. Default gemini
  // (Omni) so older clients / retries keep the original behaviour.
  const videoProvider: "gemini" | "seedance" = body?.provider === "seedance" ? "seedance" : "gemini";
  // Seedance bills per second and takes 4-15s; Omni is fixed 10s. Popup
  // defaults to 10s for both.
  const reqDur = Math.round(Number(body?.duration) || 10);
  const duration = videoProvider === "seedance" ? Math.max(4, Math.min(15, reqDur)) : 10;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("id, user_id, project_id, output_url, status, metadata")
    .eq("id", historyId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Storyboard tak dijumpai" }, { status: 404 });
  const meta = (row.metadata || {}) as Record<string, any>;
  if (meta.feature !== "storyboard") return NextResponse.json({ error: "Bukan storyboard" }, { status: 400 });
  const storyboardUrl = String(row.output_url || "").trim();
  if (row.status !== "done" || !storyboardUrl) {
    return NextResponse.json({ error: "Storyboard belum siap — tunggu ia render dulu." }, { status: 400 });
  }

  const sub = String(meta.sub || "");
  const main = String(meta.main || "ugc");
  const productName = String(meta.product_name || "");
  const productDetail = String(meta.product_detail || "");
  const productImage = (Array.isArray(meta.image_urls) ? meta.image_urls : []).filter((u: any) => typeof u === "string" && u.trim())[0] || "";

  // Omni = flat per-10s-video rate; Seedance = live per-second rate × duration
  // (settle re-reads the same live rate, so admin price changes apply).
  const cost =
    videoProvider === "seedance"
      ? Number(((await getSeedanceRate()) * duration).toFixed(4))
      : Number((await getGeminiRate("10")).toFixed(4));
  if (!(await hasEnoughCredits(user.id, cost))) {
    return NextResponse.json({ error: `Kredit tak cukup untuk video (perlu RM ${cost.toFixed(2)}). Top up dulu.` }, { status: 402 });
  }

  // Dynamic creative-direction line, matched to the sub-style + product.
  let creative = `Create a ${main === "pc" ? "premium cinematic" : "natural UGC-style"} 10-second vertical video for the product, Malaysian presenter and setting.`;
  try {
    const llm = await orChat({
      modelKey: "model_custom_idea",
      systemPrompt:
        `Write ONE vivid creative-direction sentence (max ~30 words) for a 10-second VERTICAL product video, matched to the given sub-style and product. ` +
        `Malaysian talent + local setting. Claim-safe (no medical/whitening words). Describe look, talent, lighting, camera motion, mood — NOT a shot list. Output ONLY the sentence.`,
      userPrompt: `Sub-style: ${sub} (${mainLabelOf(main)}). Product: ${productName || "(unnamed)"} — ${productDetail || "(no detail)"}.`,
      temperature: 0.9,
      maxTokens: 120,
    });
    if (llm.ok && llm.content && llm.content.trim().length > 15) creative = llm.content.trim().replace(/^["']|["']$/g, "");
  } catch {
    /* fall back to the default creative line */
  }

  // FIXED role-split prefix + DYNAMIC creative direction.
  const prompt =
    `Use image 1 as the storyboard blueprint ONLY — follow its panels and actions in order, but do NOT show or display the storyboard grid itself; open directly on live action at 0:00. ` +
    `Use image 2 ONLY as the product identity reference (copy the exact label text, colour, shape and packaging; never redraw or invent the label — if it can't be shown sharply, angle the product away). ` +
    `${creative} ` +
    `Malaysian presenter, natural Bahasa Melayu voiceover (no Indonesian slang), on-screen captions short and correctly spelled, vertical 9:16, about ${duration} seconds. No on-screen medical or whitening claims.`;

  const imageUrls = [storyboardUrl, productImage].filter(Boolean).slice(0, 2);

  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: (row as any).project_id ?? null,
      type: "video",
      tab: "original-video",
      status: "pending",
      prompt,
      reference_url: imageUrls[0],
      duration,
      cost: 0,
      metadata: {
        feature: "original-video",
        from_storyboard: historyId,
        // Carry the storyboard's campaign position so the Original Video card
        // can show "🎬 N/M · <sub>".
        campaign: meta.campaign || false,
        campaign_index: meta.campaign_index || null,
        campaign_total: meta.campaign_total || null,
        // Provider picked in the storyboard popup. model/modelChoice drive the
        // cascade pool + rate lookup on Resubmit and at settle.
        model: videoProvider === "seedance" ? "seedance" : "google/gemini-omni",
        modelChoice: videoProvider,
        ...(videoProvider === "gemini" ? { cinemaProvider: "crun" } : {}),
        imageMode: "ingredient",
        resolution: videoProvider === "seedance" ? "720p" : "1080p",
        aspectRatio: null,
        image_urls: imageUrls,
        sub,
        main,
        upload_status: "queued",
      },
    })
    .select("id, metadata")
    .single();
  if (!hist) return NextResponse.json({ error: "DB insert gagal" }, { status: 500 });

  after(async () => {
    const r = await generateVideoWithCascade({
      primaryModel: videoProvider === "seedance" ? "seedance" : "google/gemini-omni",
      userId: user.id,
      prompt,
      imageUrls,
      imageMode: "ingredient",
      durationMode: String(duration),
      aspectRatio: "9:16",
      // Each provider draws from its own admin-configured pool, so a
      // storyboard video cascades/falls back exactly like the same model
      // fired from the Original Video tab.
      asset: videoProvider === "seedance" ? "seedance" : "gemini",
    });
    if (r.ok) {
      await admin
        .from("history")
        .update({
          task_id: r.taskId,
          cost,
          metadata: { ...(hist.metadata || {}), provider: r.actualProvider, slot: r.actualSlot, ...(typeof (r as any).keyIndex === "number" ? { p6_key_index: (r as any).keyIndex } : {}), model: r.actualModel, fallback_used: r.fallbackUsed, tier_log: r.tierLog },
        })
        .eq("id", hist.id);
    } else {
      await admin.from("history").update({ status: "failed", error_message: r.error, cost }).eq("id", hist.id);
    }
  });

  return NextResponse.json({ ok: true, history_id: hist.id, cost });
}
