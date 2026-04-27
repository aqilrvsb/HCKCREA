// UGC Agent v2 — slim orchestrator + skill library architecture.
//
// Replaces the monolithic ~5800-token system prompt with:
//   • ~1000-token orchestrator (rules + tools + workflow)
//   • SKILL INDEX listing every available skill id (~1100 tokens)
//   • fetch_skill tool that loads ~400-700 token skill bodies just-in-time
//
// Net: agent context per turn drops from ~6500 → ~2200 baseline.
// When relevant skills are fetched (1-3 per generation), context lands at
// ~3500-4500 — still well under the previous baseline. AND the agent now
// has DEEP narrow knowledge (vs shallow broad) leading to better prompts.
//
// Why: Kimi K2.6 is a reasoning model — every turn it consumes tokens on
// internal chain-of-thought. With a 6.5K-token system prompt + heavy
// reasoning, every turn hit the 180s Vercel timeout. Slimming the orchestrator
// + lazy skill fetch keeps each turn fast.

import type { ToolDefinition } from "@/lib/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { renderSkillIndex } from "@/lib/skills/loader";
import { makeFetchSkillTool } from "@/lib/skills/fetch-tool";
import { getCachedProductOcr } from "@/lib/product-ocr";

// ──────────────────────────────────────────────────────────────────────────
// Slim orchestrator — ~1000 tokens of rules + tool list + workflow.
// SKILL INDEX (~1100 tokens) is appended dynamically.
// ──────────────────────────────────────────────────────────────────────────

const UGC_ORCHESTRATOR = `You are the UGC Agent — Malaysian TikTok UGC strategist powered by Veo 3.1 fast.

ROLE
- Veo 3.1 fast only (r2v / i2v / t2v) for affiliate UGC, talking heads, virtual try-on, tutorials, product reveals.
- If user asks for cinematic / atmospheric / hyper motion → redirect to Cinema tab.
- If user asks for still images → redirect to Image tab.
- Off-topic (recipes, jokes, code) → reply: "Saya specialist UGC sahaja — boleh tolong korang dengan video sahaja."

LANGUAGE — STRICT
- ALWAYS chat with the user in MALAY. Casual Malay-EN code-switch — marketer-to-marketer tone.
  Code-switch English for technical terms only ("aspect ratio", "variant", "Pro plan").
  Never reply in pure English even if user types English — read intent, reply in Malay.
- The Veo prompts you BUILD (after SUBMIT) are written in ENGLISH (better adherence).
  Veo dialog inside the prompt CAN be Malay slang — that's fine, that's what the avatar will speak.
- INSIDE video dialog use slang: korang, aku, akak, gila, memang, confirm, kan, tau, jap, eh, padu, gempak, terbaik, syok.
- NEVER formal Malay (saya/anda/tuan/puan) — sounds robotic.
- NEVER dead phrases: "Hi guys! Harini aku nak review…", "Assalamualaikum dan selamat sejahtera…", "game changer!".

GOAL
- Make it EASY for the user to generate the highest-quality UGC ad possible.
- You are their creative director — guide, suggest, dig.
- Each turn: (1) summarize what we've agreed in 1 line, (2) suggest 1-2 specific tambahan, (3) ask the next dig question.
- Keep digging until user is happy. Examples:
  · "Audience target sapa — ibu rumah, 20s gym, professional?"
  · "Pain point dia apa — masa, kos, hasil tak nampak?"
  · "Berapa variant nak — 3 untuk test, 5 untuk batch ad?"
  · "Voice female muda atau matang? Hijab atau tak?"

AVAILABLE TOOLS
1. fetch_skill({ id?, kind?, query? }) — load deep knowledge on one scene/persona/hook/framework/cta/voice/lock/cultural rule. Call this BEFORE building prompts to get the actual phrases, dialog patterns, failure modes, and Veo prompt skeletons. Use the SKILL INDEX below to pick exact ids; or pass a query for fuzzy search.
2. recall_starred_prompts({ limit }) — read user's starred past wins ("make 3 more like the gym one"). Call FIRST when user references prior work.
3. get_credits() — check user's balance before suggesting batches > 5 videos.
4. generate_ugc_variants({ product_image_url, product_description, variants: [...], duration, aspect_ratio }) — plan N variants (max 10 per call) and return a confirmation dialog. User edits + fires from there.

CONVERSATION STYLE
- Default to SHORT Malay replies — 1-3 sentences. Macam chat dengan kawan.
- Each turn: summarize → suggest → ask. NEVER essay.
- DO NOT preemptively fetch skills or build prompts. The user sees your tool calls — spamming fetch_skill before SUBMIT looks busy and breaks the flow.
- "Cukup detail dah?" → user replies SUBMIT to lock in.

🚨 CRITICAL: NEVER call generate_ugc_variants until the user message contains "SUBMIT" (any case)
- "buat lagi emotional" → just chat in Malay. NO tool call.
- "guna Casual Bestie persona" → acknowledge ("Ok lock Casual Bestie"), continue. NO tool call.
- "tunjuk apa kau nak buat" → describe rough idea in Malay. NO tool call.

🚨 ON SUBMIT — FIRE IMMEDIATELY IN THE SAME TURN, NEVER ASK FOR ANOTHER CONFIRMATION
The user types SUBMIT exactly once. Your job in that single turn:
    1. Fetch the relevant skills (typically 5: scene + persona + hook + framework + voice)
    2. Build the final 80-140 word Veo prompts IN ENGLISH for each variant
    3. CALL generate_ugc_variants — this MUST happen in the same turn as the SUBMIT
    4. The frontend renders an inline Approve/Reject card. DO NOT describe it in chat.

⛔ FORBIDDEN after SUBMIT:
- "Aku hit tool limit, taip SUBMIT lagi sekali" — never ask for another SUBMIT
- "Cakap ok atau SUBMIT lagi" — never ask for confirmation in chat
- Returning a text reply listing the variants WITHOUT also calling generate_ugc_variants

If you have to choose between fetching one more skill OR calling generate_ugc_variants, ALWAYS prioritise the generate call. Fetch fewer skills if needed — better to have a slightly less-tuned prompt than to make the user re-type SUBMIT.

PRODUCT REFERENCE AUTO-MODE: If state has last_attached_image_url, automatically use it as the product reference. The fire path picks the right Veo model:
    - reference present → r2v (image-to-video, product locked by pixels)
    - no reference → t2v (pure text-to-video)
You don't need to ask the user — just check state and let the tool pick.

After SUBMIT and approval: reply ONE LINE in Malay: "Done — X video tengah jana, akan muncul kat History."
After SUBMIT and rejection: ask in Malay what to revise. Wait for next SUBMIT.

WORKFLOW
- Phase 1 — Discover. User describes product/goal; you confirm + ask 1-2 questions in Malay.
- Phase 2 — Refine. User adds detail. You summarize + suggest. Malay only. NO TOOLS.
- Phase 3 — Submit. User types SUBMIT. NOW fetch skills + build ENGLISH Veo prompts + call generate_ugc_variants.

DIVERSITY RULE (key vs Auto Content)
When count > 1, EACH variant differs on scene OR persona OR hook OR voice. Same product, different angles. Don't rotate one variable — vary multiple.

LIMITS
- Max 10 variants per call. If user asks for more, propose 10 strongest + ask for second batch after.
- For batches > 5, call get_credits first.

PROMPT WRITING (Veo conventions)
- 9-slot order: Subject → Action → Setting → Visual style → Camera+lens → Lighting → Motion physics → Audio → Output.
- Dialog: \`Character says: '<line>'\` (colon syntax — reduces subtitle hallucination).
- Beat math 8s (target 20-24 total words BM/EN): 0-2s hook (4-6 words) | 2-5.5s core (10-14 words) | 5.5-7s reaction (mostly visual, 0-2 words) | 7-8s outro (4-6 words).
- Camera: name preset (Selfie POV / Static medium close-up / Slow dolly-in / Handheld) — never "camera moves smoothly".
- Light: name a source. Vague lighting = visual warping.
- Audio: 5-layer (Dialogue / SFX / Ambience / Music / Negatives). Music ducks under dialog.
- ONE speaker per clip. Multi-speaker = staggered shots.
- Brand names blocked → describe by appearance ("matte black bottle with gold cap").
- Locks (anatomy/audio/product/UGC-authenticity/visual) and negative block are AUTO-APPENDED by code. DO NOT include them in your prompt body.

REPLIES: tight. Variants approved/rejected inline in chat — not via popup.

SKILL INDEX (call fetch_skill with these ids)
{{SKILL_INDEX}}`;

export const UGC_SYSTEM_PROMPT = UGC_ORCHESTRATOR.replace(
  "{{SKILL_INDEX}}",
  renderSkillIndex("ugc")
);

// ──────────────────────────────────────────────────────────────────────────
// Helper — append the universal locks + negatives to every prompt
// ──────────────────────────────────────────────────────────────────────────

function withLocks(corePrompt: string, voiceLine?: string): string {
  const locks = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.
VISUAL: RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags.

Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot (unless explicitly chosen), staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, multiple speakers, voiceover narration, music score.`;
  return `${corePrompt.trim()}${voiceLine ? `\n\nVoice direction: ${voiceLine}` : ""}${locks}`;
}

// ──────────────────────────────────────────────────────────────────────────
// generate_ugc_variants — same shape as v1, but no longer needs to bake
// scene/persona/hook enums (those are in skill files now). The agent picks
// freely; the validator just checks max-10-cap.
// ──────────────────────────────────────────────────────────────────────────

const generateUgcVariants: ToolDefinition = {
  name: "generate_ugc_variants",
  description:
    "Plan one or more UGC video variants (1-10 max per call) and return a confirmation dialog payload. " +
    "Each variant must be a complete MCSLA Veo 3.1 fast prompt (80-140 words), built from skills you've " +
    "already fetched via fetch_skill. When count > 1, make each variant DISTINCT (different scene OR persona " +
    "OR hook OR voice). The user reviews + edits + fires from the confirmation dialog — never fire directly.",
  parameters: {
    type: "object",
    properties: {
      product_image_url: {
        type: "string",
        description: "Public URL of product reference image. Use ctx state if user attached earlier.",
      },
      product_description: {
        type: "string",
        description:
          "Concrete physical description (color, shape, packaging, label). Never use brand names — describe by appearance.",
      },
      variants: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        description:
          "List of variants (1-10 max). Each MUST be distinct in scene/persona/hook/voice when count > 1.",
        items: {
          type: "object",
          properties: {
            scene: { type: "string", description: "Scene id (from SKILL INDEX) used to build this variant. e.g. 'kitchen-sambal', 'gym-supplement'." },
            persona: { type: "string", description: "Persona id used. e.g. 'urban-hijabi-bestie', 'gym-bro'." },
            hook: { type: "string", description: "Hook id used. e.g. 'pain-confession', 'pov'." },
            framework: { type: "string", description: "Framework id used. e.g. 'pas', 'bab-extended'." },
            cta: { type: "string", description: "CTA id used. e.g. 'tap-beg-kuning', 'urgency'." },
            voice: {
              type: "string",
              enum: ["achernar", "achird", "algenib", "callirrhoe", "charon", "enceladus", "gacrux", "iapetus"],
              description: "Voice preset id. Match to character.",
            },
            gender: { type: "string", enum: ["female", "male"] },
            hijab: { type: "string", enum: ["yes", "no"] },
            age: { type: "string", enum: ["20s", "30s", "40s", "50s"] },
            prompt: {
              type: "string",
              description:
                "For 8s: the complete Veo prompt (80-140 words). For 16s: this is the SEG-1 prompt (hook + setup, ~80-140 words). Include dialog with colon syntax (Character says: '<line>'). Front-load Subject + Camera. Don't include locks/negatives — auto-appended.",
            },
            seg2_prompt: {
              type: "string",
              description:
                "REQUIRED for 16s only. The seg-2 continuation prompt (~80-140 words). Picks up from the chosen frame_anchor moment. Same character + voice + lighting as seg-1 (continuity locks auto-injected). Should deliver the payoff/reveal/CTA. NEVER repeat seg-1's hook.",
            },
            character_lock: {
              type: "string",
              description:
                "REQUIRED for 16s. ONE descriptor block reused VERBATIM in both seg-1 and seg-2 prompts to lock identity across the cut. Example: 'A 26-year-old Malay woman in soft pastel hijab, warm medium-brown skin, dewy minimal-makeup, modest cream-coloured top.' Code re-injects this into seg-2 along with voice + product text lock.",
            },
            frame_anchor: {
              type: "string",
              enum: ["first", "middle", "last"],
              description:
                "For 16s only. Which frame from seg-1 anchors seg-2's start. Pick based on the scene's recommended_anchor (mukbang=middle, before-after=last, gym=last, etc.). Default 'last'.",
            },
            caption: { type: "string", description: "Short Malay TikTok caption with 2-4 hashtags." },
          },
          required: ["scene", "persona", "voice", "gender", "prompt"],
        },
      },
      duration: {
        type: "string",
        enum: ["8", "16"],
        default: "8",
        description:
          "8 = single Veo gen, 1 round-trip. 16 = TWO segments (8s + 8s) auto-chained by the backend: seg-1 fires → settles → frame extracted at frame_anchor → seg-2 fires with character/voice/product locks → merges into final 16s WebM. For 16s each variant MUST also provide seg2_prompt + character_lock + frame_anchor.",
      },
      aspect_ratio: { type: "string", default: "9:16" },
    },
    required: ["product_description", "variants"],
  },
  handler: async (args, ctx) => {
    const rawVariants = Array.isArray(args.variants) ? args.variants : [];
    if (rawVariants.length === 0) {
      return { ok: false, error: "No variants provided" };
    }
    const variants = rawVariants.slice(0, 10);

    const productImageUrl =
      args.product_image_url || ctx.state.last_attached_image_url || "";

    const voiceMap: Record<string, string> = {
      achernar: "Achernar — soft, high-pitched, gentle female voice. Light airy timbre.",
      achird: "Achird — friendly, mid-pitch, warm masculine voice.",
      algenib: "Algenib — gravelly, low-pitched, masculine voice. Deep rough timbre.",
      callirrhoe: "Callirrhoe — neutral mid-pitch female voice, natural conversational.",
      charon: "Charon — deep authoritative masculine voice.",
      enceladus: "Enceladus — mature warm female voice, mom-tone.",
      gacrux: "Gacrux — energetic excited masculine voice, hype.",
      iapetus: "Iapetus — young upbeat female voice, Gen Z energy.",
    };

    const duration = args.duration === "16" ? "16" : "8";

    const prepared = variants.map((v: any) => {
      const voiceLine = voiceMap[v.voice] || undefined;
      return {
        scene: v.scene || "custom",
        persona: v.persona || "casual-bestie",
        hook: v.hook || "",
        framework: v.framework || "",
        cta: v.cta || "",
        voice: v.voice,
        gender: v.gender,
        hijab: v.hijab,
        age: v.age,
        caption: v.caption || "",
        // For 8s: prompt has locks applied immediately. For 16s: keep RAW so
        // confirmAndFireUgc can compose seg-1 = prompt+character_lock+voice+locks
        // and seg-2 = seg2_prompt+character_lock+voice+productLock+locks.
        prompt: duration === "16" ? String(v.prompt || "") : withLocks(v.prompt || "", voiceLine),
        seg2_prompt: duration === "16" ? String(v.seg2_prompt || "") : "",
        character_lock: duration === "16" ? String(v.character_lock || "") : "",
        frame_anchor:
          duration === "16"
            ? (["first", "middle", "last"].includes(v.frame_anchor) ? v.frame_anchor : "last")
            : "",
        voice_line: voiceLine || "",
      };
    });

    const priceKey = duration === "16" ? "video_16s" : "video_8s";
    const ratePerVideo = await priceFor(ctx.userId, priceKey);
    const totalCost = ratePerVideo * prepared.length;

    ctx.state.pending_ugc_batch = {
      product_image_url: productImageUrl,
      product_description: args.product_description,
      duration: args.duration || "8",
      aspect_ratio: args.aspect_ratio || "9:16",
      variants: prepared,
    };

    return {
      ok: true,
      kind: "requires_confirmation",
      summary: `Prepared ${prepared.length} UGC variant${
        prepared.length > 1 ? "s" : ""
      }. Estimated cost RM ${totalCost.toFixed(
        2
      )}. Showing user the confirmation dialog now.`,
      ui: {
        type: "confirm_generation",
        bucket: "ugc",
        params: {
          product_image_url: productImageUrl,
          product_description: args.product_description,
          duration: args.duration || "8",
          aspect_ratio: args.aspect_ratio || "9:16",
          variants: prepared,
        },
        estimated_cost: Number(totalCost.toFixed(4)),
      },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// recall_starred_prompts — read past wins from saved_prompts library
// ──────────────────────────────────────────────────────────────────────────

const recallStarredPrompts: ToolDefinition = {
  name: "recall_starred_prompts",
  description:
    "Read the user's starred past UGC prompts. Call FIRST when user says 'like the gym one' or references a past win.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", default: 5 },
    },
  },
  handler: async (args, ctx) => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("saved_prompts")
      .select("id, prompt_text, scene_template, model, user_notes, created_at")
      .eq("user_id", ctx.userId)
      .eq("bucket", "ugc")
      .eq("starred", true)
      .order("created_at", { ascending: false })
      .limit(Math.min(20, Math.max(1, Number(args.limit || 5))));

    if (!data || data.length === 0) {
      return {
        ok: true,
        kind: "info",
        summary: "User has no starred UGC prompts yet.",
      };
    }

    const lines = data
      .map(
        (p: any, i: number) =>
          `${i + 1}. [${p.scene_template || "custom"}] ${p.prompt_text.slice(0, 240)}${p.prompt_text.length > 240 ? "…" : ""}${p.user_notes ? `  (note: ${p.user_notes})` : ""}`
      )
      .join("\n");

    return {
      ok: true,
      kind: "info",
      summary: `Starred UGC prompts (${data.length}):\n${lines}`,
    };
  },
};

const getCredits: ToolDefinition = {
  name: "get_credits",
  description:
    "Get the user's current credit balance + plan. Use before suggesting batches > 5 videos.",
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
      summary: `Balance: RM ${Number(data.credits).toFixed(2)} · Plan: ${data.plan} · Expires: ${data.plan_expires_at || "—"}`,
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Tool registry — exported to the chat route
// ──────────────────────────────────────────────────────────────────────────

export const UGC_TOOLS: ToolDefinition[] = [
  makeFetchSkillTool("ugc"),
  recallStarredPrompts,
  getCredits,
  generateUgcVariants,
];

// ──────────────────────────────────────────────────────────────────────────
// confirmAndFireUgc — fires N Veo r2v in parallel.
//
// 8s mode: each variant = ONE history row, ONE Veo gen.
// 16s mode: each variant = ONE PARENT history row (segment_index=1) + the
// first Veo gen. When seg-1 settles, settle-hook fires seg-2 with locks +
// frame extracted at frame_anchor. When seg-2 settles, hook merges + sets
// parent.merged_url.
// ──────────────────────────────────────────────────────────────────────────

export async function confirmAndFireUgc(opts: {
  userId: string;
  projectId: string | null;
  conversationId: string;
  product_image_url: string;
  product_description: string;
  duration: string;
  aspect_ratio: string;
  variants: Array<{
    scene: string;
    persona: string;
    hook?: string;
    framework?: string;
    cta?: string;
    voice: string;
    gender: string;
    hijab?: string;
    age?: string;
    prompt: string;
    seg2_prompt?: string;
    character_lock?: string;
    frame_anchor?: string;
    voice_line?: string;
    caption?: string;
  }>;
}): Promise<{
  ok: boolean;
  history_ids?: string[];
  total_cost?: number;
  error?: string;
}> {
  const { variants } = opts;
  if (variants.length === 0) return { ok: false, error: "No variants" };

  const is16s = opts.duration === "16";
  const priceKey = is16s ? "video_16s" : "video_8s";
  const ratePerVideo = await priceFor(opts.userId, priceKey);
  const totalCost = ratePerVideo * variants.length;
  if (!(await hasEnoughCredits(opts.userId, totalCost))) {
    return {
      ok: false,
      error: `Kredit tak cukup. Perlu RM ${totalCost.toFixed(2)}.`,
    };
  }

  // For 16s: run Product OCR once for the product image (cached). Result is
  // saved on each variant's metadata so the seg-2 settle-hook can build the
  // PRODUCT TEXT LOCK without re-running OCR.
  let productOcr: any = null;
  if (is16s && opts.product_image_url) {
    productOcr = await getCachedProductOcr(opts.userId, opts.product_image_url).catch(
      () => null
    );
  }

  const cfg = await getP2Config();
  const admin = createAdminClient();
  const histories: any[] = [];

  await Promise.all(
    variants.map(async (v, idx) => {
      const refImage = opts.product_image_url;
      const useIngredient = !!refImage;
      const model = useIngredient ? cfg.videoR2V : cfg.videoT2V;

      // Build seg-1 prompt. For 16s, inject character_lock so the same identity
      // descriptor appears in seg-1 (and will be re-pasted into seg-2 by the
      // settle hook for continuity).
      let seg1Prompt = v.prompt;
      if (is16s && v.character_lock) {
        seg1Prompt = `${v.prompt.trim()}\n\n${v.character_lock.trim()}`;
        // Apply locks here since v.prompt arrived raw (handler skipped withLocks for 16s)
        seg1Prompt = withLocks(seg1Prompt, v.voice_line || undefined);
      }

      const created = await p2CreateTask({
        model,
        prompt: seg1Prompt,
        imageUrls: refImage ? [refImage] : [],
        durationMode: "8", // ALWAYS 8s per Veo gen — 16s = TWO gens chained
        aspectRatio: opts.aspect_ratio,
        imageMode: useIngredient ? "ingredient" : "text",
      });

      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: opts.userId,
          project_id: opts.projectId,
          type: "video",
          tab: "video",
          status: created.ok && created.task_id ? "pending" : "failed",
          prompt: seg1Prompt,
          caption: v.caption || "",
          framework: `${v.scene}/${v.persona}/${v.hook || ""}/${v.framework || ""}/${v.cta || ""}`,
          reference_url: refImage || null,
          task_id: created.task_id || null,
          duration: is16s ? 16 : 8,
          cost: ratePerVideo,
          // For 16s: this row is the PARENT. segment_index=1 marks seg-1.
          // No parent_history_id (it IS the parent). frame_anchor stored on
          // the parent row so the settle hook knows where to extract.
          segment_index: is16s ? 1 : null,
          frame_anchor: is16s ? (v.frame_anchor || "last") : null,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: {
            idx,
            model,
            agent: "ugc",
            conversation_id: opts.conversationId,
            scene: v.scene,
            persona: v.persona,
            hook: v.hook,
            framework: v.framework,
            cta: v.cta,
            voice: v.voice,
            voice_line: v.voice_line || "",
            gender: v.gender,
            hijab: v.hijab,
            age: v.age,
            imageMode: useIngredient ? "ingredient" : "text",
            aspectRatio: opts.aspect_ratio,
            // 16s-specific — settle hook reads these to fire seg-2 + merge
            ...(is16s
              ? {
                  duration_mode: "16s",
                  seg2_prompt: v.seg2_prompt || "",
                  character_lock: v.character_lock || "",
                  product_ocr: productOcr || null,
                  product_image_url: refImage || "",
                  product_description: opts.product_description,
                }
              : {}),
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
    tab: "ugc",
    tool_name: "confirm_and_fire_ugc",
    params: {
      variant_count: variants.length,
      duration: opts.duration,
      aspect: opts.aspect_ratio,
    },
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
