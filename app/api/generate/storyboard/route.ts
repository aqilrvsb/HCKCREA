import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { loadSubCards, extractGlobalRules, extractSubCard } from "@/lib/storyboard-cards";
import { productLockRule } from "@/lib/storyboard-locks";

export const runtime = "nodejs";
// 300s so a large batch's background after() (prompt planning + firing every
// image cascade) can never be killed before all rows submit — an orphaned
// pending row (no task_id) would otherwise spin "Generating…" forever.
export const maxDuration = 300;
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

// HARD RULE — storyboard grids must be 100% caption/subtitle free. Appended to
// every final image prompt so it holds no matter what the planner wrote. The
// storyboard is a visual blueprint only; captions/voiceover come later at the
// video stage.
const NO_SUBTITLE_RULE =
  "\n\nABSOLUTE HARD RULE — NO TEXT WHATSOEVER: this storyboard image must contain ZERO text of any kind. No subtitles, no captions, no on-screen words, no dialogue text, no headlines, no labels overlaid on the scene, no watermarks, no typography, no lettering, no numbers, no speech bubbles, no UI/graphics text. The ONLY text allowed is the product's own real packaging label as it physically appears on the product. Every panel is pure imagery (people, product, action, setting) with NO written words added.";

// Optional — when the client ticks "No CTA", the storyboard must not end on or
// include any call-to-action beat (no "buy now", no add-to-cart, no swipe-up,
// no directing the viewer to purchase). Pure content only.
const NO_CTA_RULE =
  "\n\nNO CALL-TO-ACTION: do NOT include any call-to-action anywhere — no 'buy now', 'order', 'add to cart', 'swipe up', 'link in bio', price tags or purchase prompts, and no final CTA frame. End on the content/benefit itself, not on a sell.";

type Main = "ugc" | "pc" | "custom";
type Job = { sub: string; main: Main; index: number; total: number; role: "variation" | "opening" | "middle" | "closing"; campaign: boolean };

const asMain = (m: any): Main => (m === "pc" ? "pc" : m === "custom" ? "custom" : "ugc");
const mainLabelOf = (m: Main) =>
  m === "custom"
    ? "Custom Idea (the client's own concept — build the storyboard around it)"
    : m === "pc"
      ? "Product Commercial (polished, cinematic)"
      : "UGC (realistic, TikTok/Reels)";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topMain: Main = asMain(body?.main);
  // Custom Idea — the client's own concept (3rd category). When present, the
  // storyboard is built around THIS instead of a sub-style card.
  const customIdea = String(body?.custom_idea || "").trim();
  // No-CTA — single/quantity + custom storyboards skip any call-to-action.
  const noCta = body?.no_cta === true;
  // No-subtitle — when ticked, the storyboard image must be 100% text-free.
  const noSubtitle = body?.no_subtitle === true;
  // Sub-style PAGE (1 proven / 2 / 3 extra variety). Absent or 1 → the proven
  // spec, so all existing traffic is byte-identical.
  const subPageRaw = Number(body?.page);
  const subPage: 1 | 2 | 3 = subPageRaw === 2 ? 2 : subPageRaw === 3 ? 3 : 1;
  // Caption instruction fed to the planner, flipped by the No-subtitle toggle.
  const captionClause = noSubtitle
    ? "NO captions/subtitles/on-screen text anywhere (pure visuals only)"
    : "one short claim-safe BM caption per frame";
  // subs can be strings (all under top-level main) OR {main, sub} objects
  // (cross-main campaign — each segment carries its own main).
  const rawSubs = Array.isArray(body?.subs) ? body.subs : body?.sub ? [body.sub] : [];
  let subItems: { main: Main; sub: string }[] = rawSubs
    .map((s: any) =>
      typeof s === "string"
        ? { main: topMain, sub: s.trim() }
        : { main: asMain(s?.main), sub: String(s?.sub || "").trim() }
    )
    .filter((x: { sub: string }) => x.sub)
    .slice(0, 8);
  // Custom Idea with no sub picked → synthesise one custom job (quantity below
  // fans it out). Its "sub" is a label; the prompt comes from customIdea.
  if (customIdea && subItems.length === 0) {
    subItems = [{ main: "custom", sub: "Custom Idea" }];
  }
  const projectId = body?.project_id ? String(body.project_id) : null;
  const product = body?.product || {};
  const productName = String(product?.name || "").trim();
  const productDetail = String(product?.detail || "").trim();
  const productImages: string[] = (Array.isArray(product?.image_urls) ? product.image_urls : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 3);
  // "Kekal Avatar" — a fixed presenter face used in every frame that shows a
  // person (frames with no person stay person-free). Empty = AI invents talent.
  // Kekal Avatar accepts 1-3 reference photos of the SAME face (multiple
  // angles → stronger consistency). Back-compat: single avatar_url still works.
  const avatarUrls: string[] = (Array.isArray(body?.avatar_urls) ? body.avatar_urls : body?.avatar_url ? [body.avatar_url] : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 2);
  const avatarUrl = avatarUrls[0] || "";

  if (subItems.length === 0) return NextResponse.json({ error: "Pilih sub-style dulu." }, { status: 400 });
  if (!productName && productImages.length === 0) {
    return NextResponse.json({ error: "Load produk dulu (Beg Kuning / Tiada Link)." }, { status: 400 });
  }
  // At least ONE product photo is mandatory. The check above is an AND, so a
  // request carrying a product NAME but zero photos used to pass — and a
  // storyboard with no product reference means gpt-image-2 invents the
  // packaging wholesale (wrong colour/cap/shape/label), which is the single
  // worst version of the "produk tak sama" complaint. The UI already gates on
  // name + >=1 attachment; this closes the API-level hole.
  if (productImages.length === 0) {
    return NextResponse.json(
      { error: "Upload sekurang-kurangnya 1 attachment produk — tanpa gambar rujukan, AI akan reka produk sendiri." },
      { status: 400 }
    );
  }
  // Kekal Avatar ticked but no face uploaded → the presenter lock silently
  // does nothing and every frame invents a different face. Fail loudly instead.
  if (body?.keep_avatar === true && avatarUrls.length === 0) {
    return NextResponse.json(
      { error: "Kekal Avatar ditick — upload sekurang-kurangnya 1 gambar muka avatar." },
      { status: 400 }
    );
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
          custom_idea: customIdea || null,
          image_urls: productImages,
          avatar_url: avatarUrl || null,
          avatar_urls: avatarUrls,
          no_cta: noCta || null,
          no_subtitle: noSubtitle || null,
          sub_page: subPage, // which sub-style page this job used (1/2/3)
          upload_status: "queued",
        },
      })
      .select("id")
      .single();
    if (hist) historyIds.push(hist.id);
  }
  if (historyIds.length === 0) return NextResponse.json({ error: "DB insert gagal" }, { status: 500 });

  // Load the execution spec for the chosen page once; global rules apply to
  // every job. Page 1 = proven spec (default); pages 2/3 = extra variety sets.
  const subCardsDoc = await loadSubCards(subPage);
  const globalRules = extractGlobalRules(subCardsDoc);

  after(async () => {
    // WEEKLY NO-REPEAT: pull the last 7 days of storyboard prompts to make new
    // ones clearly different. Scope is the PROJECT ("profile"), NOT the whole
    // user account — TikTok duplicate-detection is per brand/account, so each
    // project keeps its OWN uniqueness pool and different projects don't
    // cross-block. Falls back to user-level only for unscoped (no-project)
    // storyboards. Best-effort.
    let pastConcepts: string[] = [];
    try {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      let recentQ = admin
        .from("history")
        .select("prompt")
        .eq("type", "image")
        .eq("tab", "image")
        .filter("metadata->>feature", "eq", "storyboard")
        .gte("created_at", weekAgo);
      // Compare within the project ("profile") when one is set; otherwise fall
      // back to this user's unscoped storyboards.
      recentQ = projectId
        ? recentQ.eq("project_id", projectId)
        : recentQ.eq("user_id", user.id);
      const { data: recent } = await recentQ
        .order("created_at", { ascending: false })
        .limit(40);
      pastConcepts = (recent || [])
        .map((r: any) => String(r.prompt || "").replace(/\s+/g, " ").trim())
        // drop the boilerplate opener so the concept (hook/scene) is what compares
        .map((p: string) => p.replace(/^ONE single 9:16 storyboard grid for ONE video only\.?\s*/i, "").slice(0, 180))
        .filter((p: string) => p.length > 30 && !/^(Storyboard ·|Campaign \d)/i.test(p));
    } catch {
      /* dedup is best-effort */
    }

    const avatarLine = avatarUrl
      ? `KEKAL AVATAR — ${avatarUrls.length} presenter face reference photo(s) attached (the SAME person${avatarUrls.length > 1 ? ", different angles" : ""}). EVERY frame that shows a human presenter MUST use THAT exact same face/person (identical across all frames — a fixed avatar). Frames that show NO person (product-only, macro, packshot, flat-lay) must NOT add a person. Do not invent other faces.\n`
      : ``;

    // ── PHASE 1: plan all prompts SEQUENTIALLY, deduping against past-week +
    //    the prompts already planned in THIS batch (so parallel/bulk gens are
    //    all distinct). Then PHASE 2 fires the images in parallel.
    const builtInBatch: string[] = [];
    const plans: Array<{ id: string; prompt: string; refImages: string[] }> = [];

    for (let k = 0; k < jobs.length; k++) {
      const job = jobs[k];
      const id = historyIds[k];
      if (!id) continue;
      const card = extractSubCard(subCardsDoc, job.sub);
      const mainLabel = mainLabelOf(job.main);

      const roleLine = job.campaign
        ? job.role === "opening"
          ? `This is the OPENING storyboard (segment 1 of ${job.total}) of ONE continuous campaign. Show the PROBLEM / HOOK phase — set up the need; the product may appear but is NOT yet used or demonstrated. **NO call-to-action here.** End on a curiosity/cliffhanger that leads INTO the next segment.`
          : job.role === "closing"
            ? `This is the CLOSING storyboard (final segment ${job.index + 1} of ${job.total}) of ONE continuous campaign. Show the RESULT / payoff phase and end with the ONE call-to-action (CTA) for the whole campaign. This is the ONLY segment allowed to have a CTA.`
            : `This is the MIDDLE storyboard (segment ${job.index + 1} of ${job.total}) of ONE continuous campaign. Show a DIFFERENT phase from the other segments — the demo/usage or the proof/benefit. **NO call-to-action.** End on a bridge to the next segment.`
        : `Variation ${job.index + 1} of ${job.total} — make the hook / framing / panel order DIFFERENT from the other variations.`;
      const campaignRule = job.campaign
        ? `CAMPAIGN RULES (this is ONE continuous story across: ${campaignArc}): (1) Each segment must show DISTINCT actions & scenes — NEVER duplicate the same hero action across segments. (2) ONLY the final/closing segment ends with a CTA; opening & middle end on a bridge, NO CTA. (3) Same product identity throughout. `
        : ``;

      const sysPrompt =
        job.main === "custom"
          ? // Custom Idea — build around the client's own concept.
            `You are a Pening Lab storyboard specialist. The CLIENT gave their OWN idea/concept below — build ONE 9:16 storyboard GRID (6–9 panels) around IT (do not force a preset sub-style).\n\n${globalRules}\n\n=== CLIENT'S CUSTOM IDEA (execute this) ===\n"""${customIdea}"""\n\n=== TASK ===\nBegin with "ONE single 9:16 storyboard grid for ONE video only.", grid spec, then execute the client's idea as per-frame scene directions (hook → beats → CTA), Malaysian talent + local setting, product identity lock (verbatim label), ${captionClause}, neutral framing. ${campaignRule}Output ONLY the final image prompt, no preamble.`
          : card
            ? `You are a Pening Lab storyboard specialist. Produce ONE image-generation prompt for a 9:16 storyboard GRID by following the RULES and the SUB-CATEGORY CARD below EXACTLY (its Signature must dominate ≥3–4 frames; follow its 10s beat flow and frame-by-frame guidance).\n\n${globalRules}\n\n=== SUB-CATEGORY CARD (${job.sub}, ${mainLabel}) ===\n${card}\n\n=== TASK ===\nWrite the storyboard image prompt now, assembling per the "UNIVERSAL IMAGE-PROMPT ASSEMBLY RECIPE": begin with "ONE single 9:16 storyboard grid for ONE video only.", grid spec, this card's Signature + shots as per-frame scene directions following its beat flow, Malaysian talent + local setting, product identity lock (verbatim label), ${captionClause}, neutral problem framing. ${campaignRule}Output ONLY the final image prompt, no preamble, no headings.`
            : `You write ONE image-generation prompt for a 9:16 UGC/product-ad STORYBOARD GRID (6–9 panels, full-bleed, no header/numbers/timecodes). The prompt MUST BEGIN with "ONE single 9:16 storyboard grid for ONE video only." Execute the "${job.sub}" sub-style under ${mainLabel}, Malaysian talent, ${captionClause}, product identity locked, neutral framing. ${campaignRule}Output ONLY the final image prompt.`;

      // NO-REPEAT context: last week's concepts + this batch's so far.
      const avoidList = [...pastConcepts, ...builtInBatch.map((p) => p.replace(/^ONE single 9:16 storyboard grid for ONE video only\.?\s*/i, "").slice(0, 180))].slice(-24);
      // Campaign segments deliberately SHARE a look (story continuity) and only
      // their ACTIONS differ; standalone variations must also differ VISUALLY.
      const dedupVisual = job.campaign
        ? ``
        : ` And make the visual EXECUTION different too — not just the hook: a different setting/location, presenter wardrobe & styling, lighting/time-of-day, camera framing, panel layout and colour mood. Two grids that look ~90% alike get flagged as duplicate content.`;
      const dedupSection = avoidList.length
        ? `\n\n🚫 NO-REPEAT — these storyboard concepts were already used (past 7 days + this batch). Your storyboard MUST be clearly DIFFERENT — a different hook, different opening scene, different framing/props, and a different visual angle.${dedupVisual} Do NOT reuse their hooks or scenes:\n${avoidList.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
        : ``;
      // Always-on (standalone only): tell the planner to deliberately
      // art-direct a distinct look so even the FIRST grid commits to specifics
      // the next ones can diverge from. The AI CHOOSES the values — nothing is
      // hardcoded here. Campaigns skip this so segments stay visually coherent.
      const visualDistinct = job.campaign
        ? ``
        : `\nVISUAL DISTINCTNESS: deliberately art-direct THIS grid's look — choose a specific setting/location, presenter wardrobe & styling, lighting & time-of-day, camera framing, panel layout (e.g. 3×3, 2×3 or 2×4) and colour mood, rather than a default template. Keep ONLY the product packaging/label and the ${avatarUrl ? "locked presenter face" : "presenter"} consistent — everything else about the look should feel freshly chosen.`;

      const userPrompt =
        `Product: ${productName || "(unnamed)"}\n` +
        `Detail: ${productDetail || "(none)"}\n` +
        (job.main === "custom" ? `Client idea: ${customIdea}\n` : `Sub-style: ${job.sub} · Category: ${mainLabel}\n`) +
        avatarLine +
        `${roleLine}${dedupSection}${visualDistinct}\n` +
        `Write the storyboard image prompt now.`;

      let prompt = `ONE single 9:16 storyboard grid for ONE video only. A ${job.main === "custom" ? "custom-concept" : job.sub} storyboard for ${productName || "the product"}, 6-9 panels, Malaysian talent, product shown clearly with exact label.`;
      try {
        const llm = await orChat({ modelKey: "model_custom_idea", systemPrompt: sysPrompt, userPrompt, temperature: 0.95, maxTokens: 800 });
        if (llm.ok && llm.content && llm.content.trim().length > 40) prompt = llm.content.trim();
      } catch {
        /* fall back to the default prompt */
      }
      builtInBatch.push(prompt);
      // Avatar photos FIRST (so the face-lock is always included even if the
      // provider caps refs), then product images. Cap 5 (provider ceiling).
      // Built BEFORE the locks below so the PRODUCT LOCK's index map ("images
      // 3–5 are the product") describes what is ACTUALLY sent — the slice can
      // drop trailing product photos, and a lock pointing at an image that
      // wasn't attached is worse than no lock at all.
      const refImages = [...avatarUrls, ...productImages].slice(0, 5);
      const sentAvatars = Math.min(avatarUrls.length, refImages.length);
      const sentProducts = refImages.length - sentAvatars;
      if (avatarUrl) {
        prompt = `${prompt}\n\nPRESENTER LOCK: the attached face reference is the fixed avatar — every human shown must be that exact same person/face across all frames; frames with no person stay person-free.`;
      }
      // Hard product lock — colour / cap / shape / label text copied verbatim.
      prompt = `${prompt}${productLockRule(sentAvatars, sentProducts)}`;
      // No-CTA (single/quantity + custom only — campaign controls its own CTA).
      if (noCta && !job.campaign) prompt = `${prompt}${NO_CTA_RULE}`;
      // Hard no-subtitle/no-text rule — ONLY when the client ticked it.
      if (noSubtitle) prompt = `${prompt}${NO_SUBTITLE_RULE}`;
      plans.push({ id, prompt, refImages });
      // Persist the planned prompt now so the "saved AI story" exists even
      // before the image renders (and feeds future weeks' dedup).
      await admin.from("history").update({ prompt }).eq("id", id);
    }

    // ── PHASE 2: fire all image generations in PARALLEL.
    await Promise.all(
      plans.map(async ({ id, prompt, refImages }) => {
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
      })
    );
  });

  return NextResponse.json({ ok: true, history_ids: historyIds, count: historyIds.length, campaign, cost: total });
}
