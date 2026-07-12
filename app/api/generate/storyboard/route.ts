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

type Main = "ugc" | "pc";
type Job = { sub: string; main: Main; index: number; total: number; role: "variation" | "opening" | "middle" | "closing"; campaign: boolean };

const mainLabelOf = (m: Main) => (m === "ugc" ? "UGC (realistic, TikTok/Reels)" : "Product Commercial (polished, cinematic)");

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topMain: Main = body?.main === "pc" ? "pc" : "ugc";
  // subs can be strings (all under top-level main) OR {main, sub} objects
  // (cross-main campaign — each segment carries its own main).
  const rawSubs = Array.isArray(body?.subs) ? body.subs : body?.sub ? [body.sub] : [];
  const subItems: { main: Main; sub: string }[] = rawSubs
    .map((s: any) =>
      typeof s === "string"
        ? { main: topMain, sub: s.trim() }
        : { main: (s?.main === "pc" ? "pc" : "ugc") as Main, sub: String(s?.sub || "").trim() }
    )
    .filter((x: { sub: string }) => x.sub)
    .slice(0, 8);
  const projectId = body?.project_id ? String(body.project_id) : null;
  const product = body?.product || {};
  const productName = String(product?.name || "").trim();
  const productDetail = String(product?.detail || "").trim();
  const productImages: string[] = (Array.isArray(product?.image_urls) ? product.image_urls : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 3);
  // "Kekal Avatar" — a fixed presenter face used in every frame that shows a
  // person (frames with no person stay person-free). Empty = AI invents talent.
  const avatarUrl = String(body?.avatar_url || "").trim();

  if (subItems.length === 0) return NextResponse.json({ error: "Pilih sub-style dulu." }, { status: 400 });
  if (!productName && productImages.length === 0) {
    return NextResponse.json({ error: "Load produk dulu (Beg Kuning / Tiada Link)." }, { status: 400 });
  }

  const campaign = subItems.length >= 2;
  // Build the job list.
  const jobs: Job[] = [];
  if (campaign) {
    subItems.forEach((it, i) => {
      const role: Job["role"] = i === 0 ? "opening" : i === subItems.length - 1 ? "closing" : "middle";
      jobs.push({ sub: it.sub, main: it.main, index: i, total: subItems.length, role, campaign: true });
    });
  } else {
    const qty = Math.max(1, Math.min(10, Math.round(Number(body?.quantity) || 1)));
    for (let i = 0; i < qty; i++) jobs.push({ sub: subItems[0].sub, main: subItems[0].main, index: i, total: qty, role: "variation", campaign: false });
  }

  const unit = await priceFor(user.id, "image_generate", "gpt_image");
  const total = Number((unit * jobs.length).toFixed(4));
  if (!(await hasEnoughCredits(user.id, total))) {
    return NextResponse.json({ error: `Kredit tak cukup (perlu RM ${total.toFixed(2)}).`, needed: total }, { status: 402 });
  }

  const campaignArc = campaign ? subItems.map((x, i) => `${i + 1}. ${x.sub} (${x.main === "ugc" ? "UGC" : "Product Commercial"})`).join(" → ") : "";
  // Group id so a batch's storyboards stay associated (for the "Tukar sub"
  // replace flow + arrangement numbering in History).
  const batchId = crypto.randomUUID();
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
          main: job.main,
          sub: job.sub,
          campaign: job.campaign,
          campaign_index: job.index + 1,
          campaign_total: job.total,
          batch_id: batchId,
          // Stored so the "Tukar sub" replace flow can rebuild the prompt.
          product_name: productName,
          product_detail: productDetail,
          image_urls: productImages,
          avatar_url: avatarUrl || null,
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
    // Generate every storyboard CONCURRENTLY — the old for-await ran them
    // sequentially (segment 2 waited for segment 1 to finish). Each job is
    // independent, so fire them all in parallel.
    await Promise.all(jobs.map(async (job, k) => {
      const id = historyIds[k];
      if (!id) return;
      const card = extractSubCard(subCardsDoc, job.sub);
      const mainLabel = mainLabelOf(job.main);

      const roleLine = job.campaign
        ? job.role === "opening"
          ? `This is the OPENING storyboard (segment 1 of ${job.total}) of ONE continuous campaign. Show the PROBLEM / HOOK phase — set up the need; the product may appear but is NOT yet used or demonstrated. **NO call-to-action here.** End on a curiosity/cliffhanger that leads INTO the next segment.`
          : job.role === "closing"
            ? `This is the CLOSING storyboard (final segment ${job.index + 1} of ${job.total}) of ONE continuous campaign. Show the RESULT / payoff phase and end with the ONE call-to-action (CTA) for the whole campaign. This is the ONLY segment allowed to have a CTA.`
            : `This is the MIDDLE storyboard (segment ${job.index + 1} of ${job.total}) of ONE continuous campaign. Show a DIFFERENT phase from the other segments — the demo/usage or the proof/benefit. **NO call-to-action.** End on a bridge to the next segment.`
        : `Variation ${job.index + 1} of ${job.total} — make the hook / framing / panel order DIFFERENT from the other variations of the same sub-style.`;
      // Anti-duplication + single-CTA rules for the campaign arc.
      const campaignRule = job.campaign
        ? `CAMPAIGN RULES (this is ONE continuous story across: ${campaignArc}): (1) Each segment must show DISTINCT actions & scenes — NEVER duplicate the same hero action across segments (e.g. if one segment shows drinking the product, another must NOT show drinking — pick a different moment/action). (2) ONLY the final/closing segment ends with a CTA; the opening & middle segments end on a bridge to the next, with NO CTA. (3) Same product identity throughout. `
        : ``;

      const sysPrompt = card
        ? // Full spec available — hand the planner the exact card + global rules.
          `You are a Pening Lab storyboard specialist. Produce ONE image-generation prompt for a 9:16 storyboard GRID by following the RULES and the SUB-CATEGORY CARD below EXACTLY (its Signature must dominate ≥3–4 frames; follow its 10s beat flow and frame-by-frame guidance).\n\n` +
          `${globalRules}\n\n=== SUB-CATEGORY CARD (${job.sub}, ${mainLabel}) ===\n${card}\n\n=== TASK ===\n` +
          `Write the storyboard image prompt now, assembling per the "UNIVERSAL IMAGE-PROMPT ASSEMBLY RECIPE": begin with "ONE single 9:16 storyboard grid for ONE video only.", then grid spec, then this card's Signature + shots as per-frame scene directions following its beat flow, Malaysian talent + local setting, product identity lock (verbatim label), one short claim-safe BM caption per frame, neutral problem framing. ` +
          campaignRule +
          `Output ONLY the final image prompt, no preamble, no headings.`
        : // Fallback if the spec isn't seeded.
          `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). ` +
          `The prompt MUST BEGIN with "ONE single 9:16 storyboard grid for ONE video only." Execute the "${job.sub}" sub-style under ${mainLabel}, 6–9 panels (hook → beats → CTA), Malaysian talent, short BM captions, product identity locked, neutral framing. ` +
          campaignRule +
          `Output ONLY the final image prompt.`;

      // Kekal Avatar: instruct the planner to lock every human frame to the
      // uploaded face, and keep person-less frames person-free.
      const avatarLine = avatarUrl
        ? `KEKAL AVATAR — a presenter face reference image is attached. EVERY frame that shows a human presenter MUST use THAT exact same face/person (identical across all frames — a fixed avatar). Frames that show NO person (product-only, macro, packshot, flat-lay) must NOT add a person. Do not invent other faces.\n`
        : ``;
      const userPrompt =
        `Product: ${productName || "(unnamed)"}\n` +
        `Detail: ${productDetail || "(none)"}\n` +
        `Sub-style: ${job.sub} · Category: ${mainLabel}\n` +
        avatarLine +
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
      if (avatarUrl) {
        prompt = `${prompt}\n\nPRESENTER LOCK: the attached face reference is the fixed avatar — every human shown must be that exact same person/face across all frames; frames with no person stay person-free.`;
      }

      // Avatar face rides as the FIRST reference image (presenter), product
      // images after it. gpt-image-2 uses them all as visual references.
      const refImages = (avatarUrl ? [avatarUrl, ...productImages] : productImages).slice(0, 4);
      const r = await generateImageWithCascade({
        primaryModel: STORYBOARD_MODEL,
        prompt,
        aspectRatio: "9:16",
        imageUrls: refImages.length > 0 ? refImages : undefined,
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
    }));
  });

  return NextResponse.json({ ok: true, history_ids: historyIds, count: historyIds.length, campaign, cost: total });
}
