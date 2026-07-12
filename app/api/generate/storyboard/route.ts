import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/generate/storyboard
// Body: { product: { name, detail, image_urls[] }, main: "ugc"|"pc", sub, quantity, project_id }
//
// Storyboard mode on the Images tab — same Load Data → MAIN → SUB flow as the
// livechat, but batch: fires `quantity` 9:16 storyboard GRID images (gpt-image-2)
// that land in the Images history grid. Each storyboard gets its own AI-built
// prompt (with a per-index variation seed) so multiples aren't identical.

const STORYBOARD_MODEL = "gpt-image-2";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const main: "ugc" | "pc" = body?.main === "pc" ? "pc" : "ugc";
  const sub = String(body?.sub || "").trim();
  const qty = Math.max(1, Math.min(4, Math.round(Number(body?.quantity) || 1)));
  const projectId = body?.project_id ? String(body.project_id) : null;
  const product = body?.product || {};
  const productName = String(product?.name || "").trim();
  const productDetail = String(product?.detail || "").trim();
  const productImages: string[] = (Array.isArray(product?.image_urls) ? product.image_urls : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 3);

  if (!sub) return NextResponse.json({ error: "Pilih sub-style dulu." }, { status: 400 });
  if (!productName && productImages.length === 0) {
    return NextResponse.json({ error: "Load produk dulu (Beg Kuning / Tiada Link)." }, { status: 400 });
  }

  const unit = await priceFor(user.id, "image_generate", "gpt_image");
  const total = Number((unit * qty).toFixed(4));
  if (!(await hasEnoughCredits(user.id, total))) {
    return NextResponse.json({ error: `Kredit tak cukup (perlu RM ${total.toFixed(2)}).`, needed: total }, { status: 402 });
  }

  const mainLabel = main === "ugc" ? "UGC (realistic, TikTok/Reels)" : "Product Commercial (polished, cinematic)";
  const admin = createAdminClient();

  // Insert N pending rows up front so they appear immediately in the grid.
  const historyIds: string[] = [];
  for (let i = 0; i < qty; i++) {
    const { data: hist } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: "image",
        tab: "image",
        status: "pending",
        prompt: `Storyboard · ${sub} · ${productName || "produk"} (${i + 1}/${qty})`,
        reference_url: productImages[0] || null,
        cost: unit,
        metadata: {
          feature: "storyboard",
          kind: "storyboard",
          image_model: STORYBOARD_MODEL,
          aspectRatio: "9:16",
          main,
          sub,
          image_urls: productImages,
          variation: i + 1,
          upload_status: "queued",
        },
      })
      .select("id, metadata")
      .single();
    if (hist) historyIds.push(hist.id);
  }

  if (historyIds.length === 0) {
    return NextResponse.json({ error: "DB insert gagal" }, { status: 500 });
  }

  // Build each prompt + fire the image cascade in the background.
  after(async () => {
    const sysPrompt =
      `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). ` +
      `The prompt MUST BEGIN with the literal sentence "ONE single 9:16 storyboard grid for ONE video only." ` +
      `Execute the "${sub}" sub-style under ${mainLabel}: design 6–9 panels (hook → beats → CTA) that are unmistakably this sub-style's signature. ` +
      `Talent = a natural Malaysian creator (Malay/Chinese/Indian per fit, may wear hijab), local vibe. On-screen text short + Bahasa Melayu. ` +
      `Lock the product identity 100% (exact label text, colour, shape, packaging). Neutral framing — no negative/medical wording. ` +
      `Output ONLY the final image prompt, no preamble.`;

    for (let i = 0; i < historyIds.length; i++) {
      const id = historyIds[i];
      const userPrompt =
        `Product: ${productName || "(unnamed)"}\n` +
        `Detail: ${productDetail || "(none)"}\n` +
        `Sub-style: ${sub} · Category: ${mainLabel}\n` +
        `Variation ${i + 1} of ${qty} — make the hook / framing / panel order DIFFERENT from other variations.\n` +
        `Write the storyboard image prompt now.`;

      let prompt = `ONE single 9:16 storyboard grid for ONE video only. A ${sub} storyboard for ${productName || "the product"}, 6-9 panels, Malaysian UGC talent, product shown clearly with exact label.`;
      try {
        const llm = await orChat({ modelKey: "model_auto", systemPrompt: sysPrompt, userPrompt, temperature: 0.9, maxTokens: 800 });
        if (llm.ok && llm.content && llm.content.trim().length > 40) prompt = llm.content.trim();
      } catch {
        /* fall back to the default prompt above */
      }

      const r = await generateImageWithCascade({
        primaryModel: STORYBOARD_MODEL,
        prompt,
        aspectRatio: "9:16",
        imageUrls: productImages.length > 0 ? productImages : undefined,
      });
      if (r.ok) {
        const { data: cur } = await admin.from("history").select("metadata").eq("id", id).single();
        await admin
          .from("history")
          .update({
            task_id: r.taskId,
            prompt,
            metadata: { ...(cur?.metadata || {}), provider: r.actualProvider, slot: r.actualSlot, model: r.actualModel },
          })
          .eq("id", id);
      } else {
        await admin.from("history").update({ status: "failed", error_message: r.error }).eq("id", id);
      }
    }
  });

  return NextResponse.json({ ok: true, history_ids: historyIds, count: historyIds.length, cost: total });
}
