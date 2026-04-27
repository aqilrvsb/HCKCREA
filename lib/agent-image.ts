// Image Agent — Banana Pro + GPT Image 2 specialist for product photography,
// character refs, composites. Same skill-library architecture as UGC v2.
//
// Key behaviour: agent fetches the decision-tree skill FIRST to choose the
// right model (Banana for atmospheric/SEA-faces/multi-ref composite, GPT-2
// for text-on-package/photoreal hero/structured visuals/multilingual).

import type { ToolDefinition } from "@/lib/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { renderSkillIndex } from "@/lib/skills/loader";
import { makeFetchSkillTool } from "@/lib/skills/fetch-tool";

// ──────────────────────────────────────────────────────────────────────────
// Slim orchestrator
// ──────────────────────────────────────────────────────────────────────────

const IMAGE_ORCHESTRATOR = `You are the Image Agent — product photography + character references + composites specialist powered by Banana Pro (Nano Banana / Gemini 2.5 Flash Image) and GPT Image 2 (OpenAI).

ROLE
- Still images only. Generates product hero shots, character portraits, composites (character + product), Amazon listings, billboards with text, hijabi editorial, lifestyle scenes.
- If user asks for video → redirect to UGC tab (affiliate UGC) or Cinema tab (cinematic).
- Off-topic → reply: "Saya specialist image sahaja — boleh tolong korang dengan gambar produk/karakter."

CRITICAL FIRST STEP — pick the right model
- ALWAYS fetch_skill({ id: "banana-vs-gpt-2" }) FIRST when user describes their image goal.
- The decision tree tells you Banana vs GPT-2. Examples:
  - Asian/Malay/hijabi face → Banana
  - Text on packaging / multilingual label → GPT-2 (decisive)
  - Photoreal hero shot with edit consistency → GPT-2
  - Character + product composite → Banana
  - Editorial / atmospheric / SEA lifestyle → Banana
  - Infographic / UI mockup / structured visual → GPT-2 (decisive)
  - Virtual try-on (multi-garment ref) → GPT-2

LANGUAGE — STRICT
- ALWAYS chat with the user in MALAY (Bahasa Melayu). Casual, friendly, marketer-to-marketer tone.
  Code-switch English words for technical terms only ("aspect ratio", "reference", "Pro plan").
  Never reply in pure English even if user writes pure English — read between lines, reply in Malay.
- The actual prompt sent to Banana / GPT-2 (after SUBMIT) is in ENGLISH (better model adherence).
  In-image text can be any language the user wants.

GOAL
- Make it EASY for the user to generate the highest-quality marketing content possible.
- You are their creative director — guide them, don't quiz them.
- Summarize what they've told you in 1-2 lines. Then ask "Apa lagi nak tambah? [1-2 specific suggestions]"
- Keep digging until the user is happy. Examples of follow-up questions:
  · "Mood macam mana — soft natural light atau studio dramatic?"
  · "Ada reference photo nak attach? Lagi mudah lock muka."
  · "Cuba bagi tau lebih sikit tentang produk — tagline, warna packaging, audience target?"
  · "Aspect ratio 9:16 untuk TikTok atau 1:1 untuk feed?"

PROMPT STYLE (BOTH models)
- Descriptive narrative paragraphs, NOT tag lists.
- 80-200 words sweet spot. Below 30 = generic. Above 300 = later clauses ignored.
- Camera/lens hardware references activate photographic mode (+1.8 quality score). Use phrases like "shot on Sony A7III, 85mm f/1.8, three-point softbox lighting".
- Word order matters — first elements weighted heaviest.
- Negative prompts via positive rephrasing only ("clean composition with no extras" not "no extras").
- Always enclose in-image text in quotes. Describe the font.

BANANA-SPECIFIC TIPS (when using Banana)
- Reference Image Anchor phrase: "Take the face from the attached reference photo as the primary identity reference. Keep facial features exactly consistent throughout."
- Up to 14 reference images on Pro tier (3 on Flash).
- Conversational editing: restart conversation every 5 edits (drift kicks in past 5).
- Text rendering accurate UNDER ~25 chars; long copy degrades. Use text-first hack: generate text concept first, then ask for image containing it.

GPT-2-SPECIFIC TIPS (when using GPT-2)
- 5-section structure: Scene / Subject / Important details / Use case / Constraints.
- Edit prompt 3-sentence pattern: change → preserve → physical realism.
- input_fidelity="high" parameter preserves identity across edits.
- For text on packaging: "Render text verbatim. No extra words. No duplicate text. No watermark."
- Spell hard words letter-by-letter for label accuracy.

AVAILABLE TOOLS
1. fetch_skill({ id?, kind?, query? }) — load deep knowledge on photographers/brand-styles/composites/decision-tree. ALWAYS fetch decision-tree first.
2. recall_starred_prompts({ limit }) — read user's starred past Image wins.
3. get_credits() — check balance.
4. generate_image({ prompt, model, reference_urls, aspect_ratio, count }) — fire 1-4 images. Returns confirmation dialog.

CONVERSATION STYLE
- Default to SHORT Malay replies — 1-3 sentences. Macam chat dengan kawan, bukan essay.
- Each turn: (1) summarize what we've agreed in 1 line, (2) suggest 1-2 specific tambahan, (3) ask the next dig question.
- DO NOT preemptively fetch skills or build prompts. The user sees your tool calls — running fetch_skill 5 times before SUBMIT looks busy and breaks the flow.
- "Cukup detail dah?" → user replies SUBMIT to lock in.

🚨 CRITICAL: NEVER call generate_image until the user message contains "SUBMIT" (any case)
- "buat lagi cinematic" → just chat, refine in plain Malay. NO tool call.
- "guna Banana untuk muka Melayu" → acknowledge ("Ok lock Banana, sebab muka Asian dia handle terbaik"), continue digging. NO tool call.
- "tunjuk apa kau nak buat" → describe in plain Malay (rough idea). NO tool call.
- ONLY when user message includes "SUBMIT" / "submit" / "Submit" → THEN:
    1. Fetch the relevant skills (decision-tree + photographer + brand + composite)
    2. Build the final 80-200 word prompt IN ENGLISH (model adherence)
    3. Call generate_image with requires_confirmation=true
    4. The frontend will render an inline Approve/Reject card — DO NOT describe it in chat.
- After SUBMIT and approval: reply ONE LINE in Malay: "Done — gambar tengah jana, akan muncul kat History."
- After SUBMIT and rejection: ask in Malay what to revise. Wait for next SUBMIT.

WORKFLOW
- Phase 1 — Discover. User describes goal; you confirm + ask 1-2 next questions. All Malay.
- Phase 2 — Refine. User adds detail. You summarize + suggest. All Malay. NO TOOLS.
- Phase 3 — Submit. User types SUBMIT. NOW fetch skills + build ENGLISH prompt + call generate_image.

REPLIES: tight Malay. No essays. No tool spam before SUBMIT.

SKILL INDEX (call fetch_skill with these ids)
{{SKILL_INDEX}}`;

export const IMAGE_SYSTEM_PROMPT = IMAGE_ORCHESTRATOR.replace(
  "{{SKILL_INDEX}}",
  renderSkillIndex("image")
);

// ──────────────────────────────────────────────────────────────────────────
// generate_image tool
// ──────────────────────────────────────────────────────────────────────────

const generateImage: ToolDefinition = {
  name: "generate_image",
  description:
    "Plan 1-4 images and return a confirmation dialog. Build the prompt from skills you've already fetched. " +
    "Pick model (banana-pro vs gpt-image-2) per the decision-tree rules. User edits + fires.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "The complete image prompt — descriptive paragraph, 80-200 words. " +
          "Include camera hardware references for photoreal modes. Quote any in-image text.",
      },
      model: {
        type: "string",
        enum: ["nano-banana-pro", "gpt-image-2"],
        description:
          "Model choice. nano-banana-pro = Banana Pro (atmospheric, SEA faces, multi-ref). gpt-image-2 = GPT Image 2 (text fidelity, photoreal hero, structured visuals).",
      },
      reference_urls: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 14 (Banana) or 16 (GPT-2) reference image URLs. Use for character / product / style refs.",
      },
      aspect_ratio: {
        type: "string",
        enum: ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3"],
        default: "1:1",
      },
      count: {
        type: "number",
        minimum: 1,
        maximum: 4,
        default: 1,
        description: "How many images to generate (1-4). Each costs full image_generate rate.",
      },
      photographer_skill_id: {
        type: "string",
        description: "Optional photographer skill id used (e.g. 'annie-leibovitz'). Tracked.",
      },
      brand_skill_id: {
        type: "string",
        description: "Optional brand-style skill id used (e.g. 'apple-product-shot').",
      },
      composite_skill_id: {
        type: "string",
        description: "Optional composite skill id used (e.g. 'character-product').",
      },
    },
    required: ["prompt", "model"],
  },
  handler: async (args, ctx) => {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) return { ok: false, error: "Empty prompt" };
    const model = args.model === "gpt-image-2" ? "gpt-image-2" : "nano-banana-pro";
    const refs: string[] = Array.isArray(args.reference_urls)
      ? args.reference_urls.filter(Boolean).map(String)
      : [];
    if (refs.length === 0 && ctx.state.last_attached_image_url) {
      refs.push(String(ctx.state.last_attached_image_url));
    }
    const aspectRatio = String(args.aspect_ratio || "1:1");
    const count = Math.min(4, Math.max(1, Math.round(Number(args.count || 1))));

    const ratePerImage = await priceFor(ctx.userId, "image_generate");
    const totalCost = Number((ratePerImage * count).toFixed(4));

    ctx.state.pending_image_batch = {
      prompt,
      model,
      reference_urls: refs,
      aspect_ratio: aspectRatio,
      count,
    };

    return {
      ok: true,
      kind: "requires_confirmation",
      summary: `Prepared ${count} image${count > 1 ? "s" : ""} via ${model}. Estimated cost RM ${totalCost.toFixed(
        2
      )}. Showing user the confirmation dialog now.`,
      ui: {
        type: "confirm_generation",
        bucket: "image",
        params: {
          prompt,
          model,
          reference_urls: refs,
          aspect_ratio: aspectRatio,
          count,
          photographer_skill_id: args.photographer_skill_id,
          brand_skill_id: args.brand_skill_id,
          composite_skill_id: args.composite_skill_id,
        },
        estimated_cost: totalCost,
      },
    };
  },
};

const recallStarredImage: ToolDefinition = {
  name: "recall_starred_prompts",
  description: "Read user's starred past Image prompts.",
  parameters: { type: "object", properties: { limit: { type: "number", default: 5 } } },
  handler: async (args, ctx) => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("saved_prompts")
      .select("id, prompt_text, scene_template, model, user_notes, created_at")
      .eq("user_id", ctx.userId)
      .eq("bucket", "image")
      .eq("starred", true)
      .order("created_at", { ascending: false })
      .limit(Math.min(20, Math.max(1, Number(args.limit || 5))));
    if (!data || data.length === 0) {
      return { ok: true, kind: "info", summary: "User has no starred Image prompts yet." };
    }
    const lines = data
      .map(
        (p: any, i: number) =>
          `${i + 1}. [${p.model || "—"}] ${p.prompt_text.slice(0, 240)}${p.prompt_text.length > 240 ? "…" : ""}${p.user_notes ? `  (note: ${p.user_notes})` : ""}`
      )
      .join("\n");
    return { ok: true, kind: "info", summary: `Starred Image prompts (${data.length}):\n${lines}` };
  },
};

const getCredits: ToolDefinition = {
  name: "get_credits",
  description: "Get user's credit balance.",
  parameters: { type: "object", properties: {} },
  handler: async (_args, ctx) => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("credits, plan, plan_expires_at")
      .eq("id", ctx.userId)
      .single();
    if (!data) return { ok: false, error: "Profile not found" };
    return {
      ok: true,
      kind: "info",
      summary: `Balance: RM ${Number(data.credits).toFixed(2)} · Plan: ${data.plan}`,
    };
  },
};

export const IMAGE_TOOLS: ToolDefinition[] = [
  makeFetchSkillTool("image"),
  recallStarredImage,
  getCredits,
  generateImage,
];

// ──────────────────────────────────────────────────────────────────────────
// confirmAndFireImage — fires N images in parallel after user confirms
// ──────────────────────────────────────────────────────────────────────────

export async function confirmAndFireImage(opts: {
  userId: string;
  projectId: string | null;
  conversationId: string;
  prompt: string;
  model: "nano-banana-pro" | "gpt-image-2";
  reference_urls: string[];
  aspect_ratio: string;
  count: number;
  photographer_skill_id?: string;
  brand_skill_id?: string;
  composite_skill_id?: string;
}): Promise<{ ok: boolean; history_ids?: string[]; total_cost?: number; error?: string }> {
  const count = Math.min(4, Math.max(1, Math.round(opts.count)));
  const ratePerImage = await priceFor(opts.userId, "image_generate");
  const totalCost = Number((ratePerImage * count).toFixed(4));

  if (!(await hasEnoughCredits(opts.userId, totalCost))) {
    return { ok: false, error: `Kredit tak cukup. Perlu RM ${totalCost.toFixed(2)}.` };
  }

  const cfg = await getP2Config();
  const modelId = (cfg.imageModels as any)?.[opts.model] || opts.model;
  const admin = createAdminClient();
  const histories: any[] = [];

  await Promise.all(
    Array.from({ length: count }).map(async (_, idx) => {
      const created = await p2CreateTask({
        model: modelId,
        prompt: opts.prompt,
        imageUrls: opts.reference_urls,
        aspectRatio: opts.aspect_ratio,
      });
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: opts.userId,
          project_id: opts.projectId,
          type: "image",
          tab: "image",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: opts.prompt,
          reference_url: opts.reference_urls[0] || null,
          task_id: created.task_id || null,
          cost: ratePerImage,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: {
            idx,
            agent: "image",
            conversation_id: opts.conversationId,
            model: opts.model,
            modelId,
            reference_count: opts.reference_urls.length,
            photographer_skill_id: opts.photographer_skill_id,
            brand_skill_id: opts.brand_skill_id,
            composite_skill_id: opts.composite_skill_id,
            aspectRatio: opts.aspect_ratio,
          },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );

  await admin.from("agent_actions").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    tab: "image",
    tool_name: "confirm_and_fire_image",
    params: { count, model: opts.model, aspect: opts.aspect_ratio },
    outcome: "fired",
    history_ids: histories.map((h) => h.id),
    cost: totalCost,
  });

  return {
    ok: true,
    history_ids: histories.map((h) => h.id),
    total_cost: totalCost,
  };
}
