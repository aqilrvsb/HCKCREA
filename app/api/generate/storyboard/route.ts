import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { loadSubCards, extractGlobalRules, extractSubCard } from "@/lib/storyboard-cards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST /api/generate/storyboard
// Body: { product, main, subs: string[], quantity, project_id }
//
// Storyboard mode on the Images tab. Two behaviours:
//   • ONE sub selected  → quantity 1–10 storyboards of that SAME sub
//                         (independent variations).
//   • 2+ subs selected  → a CONNECTED campaign storyline: one storyboard per
//                         sub, in order, that continue each other (opening →
//                         … → closing/CTA). quantity is ignored.
// Each fires a 9:16 storyboard GRID image (gpt-image-2) into the Images grid.

const STORYBOARD_MODEL = "gpt-image-2";

type Job = { sub: string; index: number; total: number; role: "variation" | "opening" | "middle" | "closing"; campaign: boolean };

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const main: "ugc" | "pc" = body?.main === "pc" ? "pc" : "ugc";
  const subs: string[] = (Array.isArray(body?.subs) ? body.subs : body?.sub ? [body.sub] : [])
    .map((s: any) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  const projectId = body?.project_id ? String(body.project_id) : null;
  const product = body?.product || {};
  const productName = String(product?.name || "").trim();
  const productDetail = String(product?.detail || "").trim();
  const productImages: string[] = (Array.isArray(product?.image_urls) ? product.image_urls : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 3);

  if (subs.length === 0) return NextResponse.json({ error: "Pilih sub-style dulu." }, { status: 400 });
  if (!productName && productImages.length === 0) {
    return NextResponse.json({ error: "Load produk dulu (Beg Kuning / Tiada Link)." }, { status: 400 });
  }

  const campaign = subs.length >= 2;
  // Build the job list.
  const jobs: Job[] = [];
  if (campaign) {
    subs.forEach((sub, i) => {
      const role: Job["role"] = i === 0 ? "opening" : i === subs.length - 1 ? "closing" : "middle";
      jobs.push({ sub, index: i, total: subs.length, role, campaign: true });
    });
  } else {
    const qty = Math.max(1, Math.min(10, Math.round(Number(body?.quantity) || 1)));
    for (let i = 0; i < qty; i++) jobs.push({ sub: subs[0], index: i, total: qty, role: "variation", campaign: false });
  }

  const unit = await priceFor(user.id, "image_generate", "gpt_image");
  const total = Number((unit * jobs.length).toFixed(4));
  if (!(await hasEnoughCredits(user.id, total))) {
    return NextResponse.json({ error: `Kredit tak cukup (perlu RM ${total.toFixed(2)}).`, needed: total }, { status: 402 });
  }

  const mainLabel = main === "ugc" ? "UGC (realistic, TikTok/Reels)" : "Product Commercial (polished, cinematic)";
  const campaignArc = campaign ? subs.map((s, i) => `${i + 1}. ${s}`).join(" → ") : "";
  const admin = createAdminClient();

  // Insert all pending rows up front so they show immediately in the grid.
  const historyIds: string[] = [];
  for (const job of jobs) {
    const label = job.campaign
      ? `Campaign ${job.index + 1}/${job.total} · ${job.sub}`
      : `Storyboard · ${job.sub} (${job.index + 1}/${job.total})`;
    const { data: hist } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: "image",
        tab: "image",
        status: "pending",
        prompt: `${label} · ${productName || "produk"}`,
        reference_url: productImages[0] || null,
        cost: unit,
        metadata: {
          feature: "storyboard",
          kind: "storyboard",
          image_model: STORYBOARD_MODEL,
          aspectRatio: "9:16",
          main,
          sub: job.sub,
          campaign: job.campaign,
          campaign_index: job.index + 1,
          campaign_total: job.total,
          image_urls: productImages,
          upload_status: "queued",
        },
      })
      .select("id")
      .single();
    if (hist) historyIds.push(hist.id);
  }
  if (historyIds.length === 0) return NextResponse.json({ error: "DB insert gagal" }, { status: 500 });

  // Load the 26-card execution spec once; global rules apply to every job.
  const subCardsDoc = await loadSubCards();
  const globalRules = extractGlobalRules(subCardsDoc);

  after(async () => {
    for (let k = 0; k < jobs.length; k++) {
      const job = jobs[k];
      const id = historyIds[k];
      if (!id) continue;
      const card = extractSubCard(subCardsDoc, job.sub);

      const roleLine = job.campaign
        ? job.role === "opening"
          ? `This is the OPENING storyboard (segment 1 of ${job.total}) of ONE connected campaign — hook the viewer and introduce the product/problem. The story CONTINUES into the next segments.`
          : job.role === "closing"
            ? `This is the CLOSING storyboard (segment ${job.index + 1} of ${job.total}) of ONE connected campaign — pay off the story with a premium close + clear call-to-action (CTA). It must feel like the ENDING that resolves the earlier segments.`
            : `This is segment ${job.index + 1} of ${job.total} of ONE connected campaign — continue the story (demo / benefit / proof), bridging the opening and the closing. Same product identity + narrative arc throughout.`
        : `Variation ${job.index + 1} of ${job.total} — make the hook / framing / panel order DIFFERENT from the other variations of the same sub-style.`;

      const sysPrompt = card
        ? // Full spec available — hand the planner the exact card + global rules.
          `You are a Pening Lab storyboard specialist. Produce ONE image-generation prompt for a 9:16 storyboard GRID by following the RULES and the SUB-CATEGORY CARD below EXACTLY (its Signature must dominate ≥3–4 frames; follow its 10s beat flow and frame-by-frame guidance).\n\n` +
          `${globalRules}\n\n=== SUB-CATEGORY CARD (${job.sub}, ${mainLabel}) ===\n${card}\n\n=== TASK ===\n` +
          `Write the storyboard image prompt now, assembling per the "UNIVERSAL IMAGE-PROMPT ASSEMBLY RECIPE": begin with "ONE single 9:16 storyboard grid for ONE video only.", then grid spec, then this card's Signature + shots as per-frame scene directions following its beat flow, Malaysian talent + local setting, product identity lock (verbatim label), one short claim-safe BM caption per frame, neutral problem framing. ` +
          (job.campaign ? `CAMPAIGN: full arc = ${campaignArc}; keep the SAME product identity + one continuous storyline across segments. ` : ``) +
          `Output ONLY the final image prompt, no preamble, no headings.`
        : // Fallback if the spec isn't seeded.
          `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). ` +
          `The prompt MUST BEGIN with "ONE single 9:16 storyboard grid for ONE video only." Execute the "${job.sub}" sub-style under ${mainLabel}, 6–9 panels (hook → beats → CTA), Malaysian talent, short BM captions, product identity locked, neutral framing. ` +
          (job.campaign ? `CAMPAIGN CONTEXT — arc: ${campaignArc}. Same product identity + one continuous storyline. ` : ``) +
          `Output ONLY the final image prompt.`;

      const userPrompt =
        `Product: ${productName || "(unnamed)"}\n` +
        `Detail: ${productDetail || "(none)"}\n` +
        `Sub-style: ${job.sub} · Category: ${mainLabel}\n` +
        `${roleLine}\n` +
        `Write the storyboard image prompt now.`;

      let prompt = `ONE single 9:16 storyboard grid for ONE video only. A ${job.sub} storyboard for ${productName || "the product"}, 6-9 panels, Malaysian UGC talent, product shown clearly with exact label.`;
      try {
        // Heavy-lifting prompt planning → model_custom_idea (grsai gemini-3-flash
        // cascade), same routing as UGC Custom Idea / Auto Content master plan.
        const llm = await orChat({ modelKey: "model_custom_idea", systemPrompt: sysPrompt, userPrompt, temperature: 0.9, maxTokens: 800 });
        if (llm.ok && llm.content && llm.content.trim().length > 40) prompt = llm.content.trim();
      } catch {
        /* fall back to the default prompt */
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
          .update({ task_id: r.taskId, prompt, metadata: { ...(cur?.metadata || {}), provider: r.actualProvider, slot: r.actualSlot, model: r.actualModel } })
          .eq("id", id);
      } else {
        await admin.from("history").update({ status: "failed", error_message: r.error }).eq("id", id);
      }
    }
  });

  return NextResponse.json({ ok: true, history_ids: historyIds, count: historyIds.length, campaign, cost: total });
}
