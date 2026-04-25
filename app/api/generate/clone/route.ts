import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { orChat } from "@/lib/openrouter";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// Clone Mode — submit reference video URL + product image, AI plans 1-4
// segments, each segment becomes a video task. NOTE: in this MVP we accept a
// reference video URL the client has already extracted frames from (or just
// passes the URL); full frame-extract via fal.ai is a follow-up.
export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const refVideoUrl = String(body?.reference_video_url || "").trim();
  const productImageUrl = String(body?.product_image_url || "").trim();
  const customDialog = String(body?.custom_dialog || "");
  const segments = Math.min(4, Math.max(1, Number(body?.segments || 2)));

  if (!refVideoUrl) {
    return NextResponse.json({ error: "Reference video URL required" }, { status: 400 });
  }
  if (!productImageUrl) {
    return NextResponse.json({ error: "Product image required" }, { status: 400 });
  }

  // Pre-flight: each segment is an 8s video
  const videoRate = await priceFor(user.id, "video_8s");
  const totalCost = videoRate * segments;
  if (!(await hasEnoughCredits(user.id, totalCost))) {
    return NextResponse.json(
      { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
      { status: 402 }
    );
  }

  // Plan segments via OpenRouter (clone-specific model)
  const systemPrompt = `You are a video director. Given a reference video URL and a product image, output exactly ${segments} 8-second segment prompts that recreate the reference's visual style with the new product. Output JSON: { "prompts": ["...", "..."] }. Each prompt: 200-500 chars, Bahasa Melayu dialog, describes a Malay UGC creator with the product, segment-specific shot/action. ONLY JSON, no prose.`;

  const userPrompt = `Reference video: ${refVideoUrl}
Product image: ${productImageUrl}
Number of segments: ${segments}
${customDialog ? `Required dialog (use verbatim where it fits): """${customDialog}"""` : ""}`;

  const plan = await orChat({
    modelKey: "model_clone",
    systemPrompt,
    userPrompt,
    temperature: 0.7,
    maxTokens: 6000,
  });
  if (!plan.ok || !plan.content) {
    return NextResponse.json(
      { error: plan.error || "Clone plan failed" },
      { status: 502 }
    );
  }

  let prompts: string[] = [];
  try {
    let cleaned = plan.content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s >= 0 && e > s) cleaned = cleaned.substring(s, e + 1);
    const obj = JSON.parse(cleaned);
    prompts = Array.isArray(obj.prompts) ? obj.prompts.filter((p: any) => typeof p === "string" && p.length > 30) : [];
  } catch {}

  if (!prompts.length) {
    return NextResponse.json({ error: "Clone plan parse failed" }, { status: 502 });
  }

  const admin = createAdminClient();
  const cfg = await getP2Config();

  // Create a parent batch row to group the segments
  const { data: batch } = await admin
    .from("batches")
    .insert({
      user_id: user.id,
      product_image_url: productImageUrl,
      quantity: prompts.length,
      duration_mode: "8",
      status: "generating",
      master_plan: prompts.map((p) => ({ prompt: p })),
    })
    .select()
    .single();

  const histories: any[] = [];
  await Promise.all(
    prompts.map(async (p, idx) => {
      const created = await p2CreateTask({
        model: cfg.videoR2V,
        prompt: p,
        imageUrls: [productImageUrl],
        durationMode: "8",
        aspectRatio: "9:16",
        imageMode: "ingredient",
      });
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          type: "clone",
          tab: "clone",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: p,
          reference_url: productImageUrl,
          task_id: created.task_id || null,
          duration: 8,
          cost: videoRate,
          batch_id: batch?.id,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: { segment_index: idx, ref_video_url: refVideoUrl },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );

  return NextResponse.json({
    ok: true,
    batch_id: batch?.id,
    history_ids: histories.map((h) => h.id),
    segments: prompts.length,
    total_cost: totalCost,
  });
}
