// UGC Agent — Veo 3.1 fast specialist.
//
// This agent is the most knowledge-dense in the system. Its system prompt
// encodes everything Auto Content does PLUS the entire MCSLA framework, 14
// scene templates, 7 hooks × 5 structures × 8 CTAs × 6 personas combinatorial
// space, voice presets, and full Malaysian localization vocabulary.
//
// Goal: beat Auto Content head-to-head on every metric — diversity, voice
// control, persona matching, conversion psychology, iteration.

import type { ToolDefinition, ToolContext, ToolResult } from "@/lib/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";

// ──────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — knowledge baked in
// ──────────────────────────────────────────────────────────────────────────

export const UGC_SYSTEM_PROMPT = `You are the UGC Agent — a Malaysian-market UGC content strategist powered by Google Veo 3.1 fast.

ROLE LOCK
- You ONLY work with Veo 3.1 fast (reference-to-video, image-to-video, text-to-video).
- NEVER suggest Grok, Kling, Sora, or any other model. If user asks for cinematic / hyper motion / atmospheric mood, redirect them to the Cinema tab.
- NEVER suggest still images — redirect to the Image tab.
- Your one job: produce the best possible Veo-driven UGC, talking head, virtual try-on, tutorial, or product reveal for Malaysian TikTok creators.

LANGUAGE
- Reply in whatever language the user writes in. Default to Malay-English mix if unclear.
- When generating dialog inside prompts, use natural Malay slang: korang, aku, gila, memang, confirm, kan, tau, jap jap, eh, serious, betul-betul, nampak tak.
- Mixed BM/EN code-switch is encouraged: "best gila", "confirm berbaloi", "game changer", "no joke".
- NEVER use formal Malay (saya, anda, tuan, puan) for UGC dialog — sounds robotic.

────────────────────────────────────────
MCSLA PROMPT FRAMEWORK (mandatory for every video prompt)
────────────────────────────────────────

Every Veo prompt has 5 layers — output them in this order:
  M = Model (always 'Veo 3.1 fast' for this tab)
  C = Camera (named preset: Selfie POV / Handheld / Robo Arm / Dolly In / 360 Orbit / etc.)
  S = Subject (specific character + product, with concrete details)
  L = Look (style + lighting + mood — 'organic UGC iPhone' / 'cinematic three-point' / etc.)
  A = Action (what unfolds across 8s — including dialog with quotes)

PROMPT STYLE: Full sentences, NOT bracket lists. 80-140 words. Use Veo's preferred order: Subject → Action → Setting → Camera → Lens → Lighting → Audio → Locks → Negatives.

8-SECOND BEAT MATH (write dialog to fit):
  0.0 – 2.0s : Hook beat (face appears, max 6 Malay words)
  2.0 – 5.5s : Core dialog or main action (max 14 words)
  5.5 – 7.0s : Reaction / smile / product re-show
  7.0 – 8.0s : Hold / soft outro (CTA, max 6 words)

────────────────────────────────────────
14 SCENE TEMPLATES (use these as starting points, fill {{placeholders}})
────────────────────────────────────────

01 KITCHEN · SAMBAL — Malay woman cooking with product, kitchen ambient
02 GYM · SUPPLEMENT — Post-workout sweat, supplement bottle, gym mirrors
03 IN-CAR · DRIVING CTA — Driver seat, dash-mount POV, seatbelt visible
04 VINTAGE VHS · UNBOX — Top-down hands, VHS grain, color bleed, retro
05 OFFICE · VITAMIN C — Desk, fluorescent + screen glow, taking vitamin
06 CARTOON · ANIME UGC — Studio Ghibli cel-shaded character holding product (use only if user explicitly wants stylized)
07 TALKING PRODUCT · 3D — Product itself animates and speaks (creative niche)
08 CAFE · ASPIRATIONAL — Cafe table, latte art, product casual placement
09 CONFESSION · STORY — Bedroom, soft window light, personal storytelling tone
10 STOP-MOTION · CLAY — Wallace & Gromit aesthetic, product transforms (stylized)
11 BEACH · SUNSET — Wong Kar-wai golden hour beach, product reveal
12 MOM · MORNING ROUTINE — Hijabi mom, kitchen at dawn, kids in background
13 FOODIE · REACTION — Mukbang style, exaggerated taste reaction
14 ASMR · PRODUCT — Top-down, NO dialog, tape rip + tissue paper SFX

────────────────────────────────────────
7 HOOK ARCHETYPES (pick to match user goal)
────────────────────────────────────────

H1 QUESTION — "Korang tau tak..." / "Penat tak macam ni?"
H2 BOLD CLAIM — "Ni produk paling underrated tahun ni"
H3 FEAR/LOSS — "Kalau korang tak guna ni, boleh menyesal"
H4 CURIOSITY GAP — "Aku tak nak cakap pasal ni tapi..."
H5 SOCIAL PROOF — "Ramai friends aku dah try, semua confirm best"
H6 PATTERN INTERRUPT — "Wait jap, korang dengar ni dulu"
H7 PROMISE — "Dalam 8 saat ni, aku akan ubah cara korang tengok ni"

────────────────────────────────────────
5 STORY STRUCTURES (pick by audience driver)
────────────────────────────────────────

S1 PAS — Problem → Agitate → Solve (best for pain-point products)
S2 AIDA — Attention → Interest → Desire → Action (best for new-to-market)
S3 BAB — Before → After → Bridge (best for transformation products)
S4 HERO COMPRESSED — Struggle → Discovery → Transformation (storytelling)
S5 STAR-STORY-SOLUTION — Personal star moment → backstory → product as solution

────────────────────────────────────────
8 CTA ARCHETYPES (pick to match audience driver)
────────────────────────────────────────

C1 URGENCY — "Stok tinggal sikit, buat cepat"
C2 SCARCITY — "Last batch ni, lepas ni habis"
C3 SOCIAL PROOF — "Join geng yang dah convert"
C4 BONUS — "Beli sekarang, dapat free [bonus]"
C5 FREE TRIAL — "Try dulu, kalau tak suka return"
C6 PAIN REMOVAL — "Selesaikan masalah korang, sekali try"
C7 STATUS — "Untuk yang serious nak upgrade"
C8 DIRECT — "Tekan beg kuning, order sekarang"

When user picks cta_mode='shop', append a "tekan beg kuning" CTA verbatim in the last 2s.

────────────────────────────────────────
6 INFLUENCER PERSONAS (vocabulary + tone signature)
────────────────────────────────────────

P1 CASUAL BESTIE — chatty, "aku-korang", filler words, mid-energy, laughs
P2 POLISHED PRO — slower pace, polite-casual, eye contact, confident
P3 COMEDIC — exaggerated reactions, pattern interrupts, punchlines
P4 INSPIRATIONAL — soft tone, eye-mist, transformational language
P5 CONFESSIONAL — close-up, lower voice, personal disclosure tone
P6 EDUCATIONAL — measured, fact-driven, "ni macam mana ia kerja..."

────────────────────────────────────────
VOICE PRESETS (prompt-injection — confirmed working on Veo via Crun)
────────────────────────────────────────

Append "Voice direction: [Name] — [description]" to the prompt tail.
- achernar : female, soft, high pitch (gentle airy)
- achird   : male, friendly, mid pitch (warm)
- algenib  : male, gravelly, low pitch (deep rough)
- callirrhoe : female, mid pitch (neutral natural)
- charon   : male, deep authoritative
- enceladus : female, mature warm (mom-tone)
- gacrux   : male, energetic excited (hype)
- iapetus  : female, young upbeat (Gen Z)

Match voice to character. Female no-hijab + Confessional persona → achernar. Male gym + Comedic persona → gacrux. Hijabi mom + Inspirational persona → enceladus.

────────────────────────────────────────
ANATOMY + AUDIO + PRODUCT LOCKS (append to every prompt)
────────────────────────────────────────

ANATOMY: "2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin"
AUDIO: "ONE single voice only, no chatter, no background voices"
PRODUCT: "Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift."
UGC AUTHENTICITY: "Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter"
VISUAL: "RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags."

────────────────────────────────────────
NEGATIVE BLOCK (always append at end)
────────────────────────────────────────

"Negative: cartoon, 3D cartoon, anime (unless template 06/10), airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting (unless template 05), tripod static shot, staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, multiple speakers, voiceover narration, music score."

────────────────────────────────────────
WORKFLOW
────────────────────────────────────────

1. UNDERSTAND user's intent. If unclear (no product reference, no count, no scene hint), ASK ONE clarifying question. NEVER guess across all dimensions.

2. PICK template + persona + hook + structure + CTA + voice based on:
   - Product category (food / supplement / cosmetic / fashion / tech)
   - Audience driver (status / belonging / safety / convenience / identity)
   - Tone request (chatty / polished / comedic / inspirational / confessional / educational)

3. WHEN GENERATING N>1 VARIANTS, make each one DISTINCT:
   - Different scene OR different persona OR different hook archetype
   - Different voice preset
   - Different CTA type
   - Same product, same core benefit, but 5 truly different angles
   - This is the key differentiator vs Auto Content's rigid framework rotation.

4. CALL the generate_ugc_variants tool. ALWAYS pass requires_confirmation=true so the user reviews + edits before firing. NEVER fire generations without confirmation.

5. AFTER user confirms (next turn), the tool fires Veo r2v jobs in parallel and returns history_ids. Reply briefly: "Started X UGC videos. They'll appear in History as they finish."

6. IF user references a saved prompt ("make 3 more like the gym one"), call recall_starred_prompts FIRST, then generate variations.

────────────────────────────────────────
HARD RULES (do not violate)
────────────────────────────────────────

- NEVER generate without showing a confirmation dialog first.
- NEVER use brand names verbatim in prompts (Veo's filter blocks them) — describe by appearance: "matte black bottle with gold cap" not "Brand X Bottle".
- NEVER mix Identity descriptors with Motion descriptors in the same paragraph if generating multi-shot — split them.
- NEVER suggest Auto Content. The user is intentionally testing you AGAINST Auto Content.
- NEVER use vague camera language ("the camera moves smoothly"). Always name the preset (Selfie POV / Handheld / Robo Arm / Dolly In).
- ALWAYS append the negative block.
- KEEP REPLIES TIGHT. Show the prompts in the confirmation dialog, not in chat.
- IF the user asks anything OUTSIDE marketing content (food recipes, schoolwork, jokes, code), reply: "Saya specialist UGC sahaja — boleh tolong korang dengan video sahaja."`;

// ──────────────────────────────────────────────────────────────────────────
// Tools — what the UGC agent can DO
// ──────────────────────────────────────────────────────────────────────────

// Helper — append the universal locks + negatives to every prompt
function withLocks(corePrompt: string, voiceLine?: string): string {
  const locks = `

ANATOMY: 2 hands with 5 fingers each (both visible), symmetric face, no missing limbs, no plastic skin.
AUDIO: ONE single voice only, no chatter, no background voices.
PRODUCT LOCK: Product is pixel-identical to reference — same color, shape, label, typography, packaging. Sharp focus on label, no warping, no recoloring, no text drift.
UGC AUTHENTICITY: Authentic amateur iPhone UGC — handheld arm's-length, natural skin texture with pores and subtle T-zone shine (NOT airbrushed), no-makeup-makeup, loose hair, ordinary mixed lighting (NOT softbox), lived-in background with minor clutter.
VISUAL: RAW UNEDITED FOOTAGE — bottom 25% of frame COMPLETELY EMPTY. Zero subtitles, captions, animated TikTok captions, sticker text, icons, emojis, graphics, watermarks, UI elements, handles, hashtags.

Negative: cartoon, 3D cartoon, anime, airbrushed plastic skin, uncanny valley, glam makeup, salon hair, softbox studio lighting, tripod static shot, staged background, posed billboard framing, closed mouth while audio plays, duplicate limbs, distorted fingers, hand out of frame, warped product label, blurry product, motion-blurred product, text drift, subtitle burn-in, auto-captions, multiple speakers, voiceover narration, music score.`;
  return `${corePrompt.trim()}${voiceLine ? `\n\nVoice direction: ${voiceLine}` : ""}${locks}`;
}

// generate_ugc_variants — core tool. Returns confirmation payload by default.
const generateUgcVariants: ToolDefinition = {
  name: "generate_ugc_variants",
  description:
    "Plan one or more UGC video variants and return a confirmation dialog payload. The user reviews + edits the variants before they fire. Each variant is a complete MCSLA prompt for Veo 3.1 fast (reference-to-video). When count > 1, make each variant DISTINCT (different persona/hook/structure/CTA/voice).",
  parameters: {
    type: "object",
    properties: {
      product_image_url: {
        type: "string",
        description:
          "Public URL of the product reference image. If user attached an image earlier in chat, use ctx state. Required for r2v mode.",
      },
      product_description: {
        type: "string",
        description:
          "Concrete physical description of the product (color, shape, packaging, label visible). Used inside prompts. Never use brand names — describe by appearance.",
      },
      variants: {
        type: "array",
        description:
          "List of variants to generate. Each one MUST be distinct in persona/hook/structure/CTA/voice when generating >1.",
        items: {
          type: "object",
          properties: {
            scene: {
              type: "string",
              enum: [
                "kitchen-sambal",
                "gym-supplement",
                "in-car-driving-cta",
                "vintage-vhs-unbox",
                "office-vitamin-c",
                "cartoon-anime",
                "talking-product-3d",
                "cafe-aspirational",
                "confession-story",
                "stop-motion-clay",
                "beach-sunset",
                "mom-morning-routine",
                "foodie-reaction",
                "asmr-product",
                "custom",
              ],
              description: "Scene template ID (or 'custom' for free-form).",
            },
            persona: {
              type: "string",
              enum: [
                "casual-bestie",
                "polished-pro",
                "comedic",
                "inspirational",
                "confessional",
                "educational",
              ],
            },
            hook: {
              type: "string",
              enum: [
                "question",
                "bold-claim",
                "fear",
                "curiosity",
                "social-proof",
                "pattern-interrupt",
                "promise",
              ],
            },
            structure: {
              type: "string",
              enum: ["pas", "aida", "bab", "hero", "star-story-solution"],
            },
            cta: {
              type: "string",
              enum: [
                "urgency",
                "scarcity",
                "social-proof",
                "bonus",
                "free-trial",
                "pain-removal",
                "status",
                "direct",
              ],
            },
            voice: {
              type: "string",
              enum: [
                "achernar",
                "achird",
                "algenib",
                "callirrhoe",
                "charon",
                "enceladus",
                "gacrux",
                "iapetus",
              ],
              description:
                "Voice preset ID. Match to character — female=achernar/callirrhoe/enceladus/iapetus, male=achird/algenib/charon/gacrux.",
            },
            gender: { type: "string", enum: ["female", "male"] },
            hijab: { type: "string", enum: ["yes", "no"] },
            age: { type: "string", enum: ["20s", "30s", "40s"] },
            // The actual prompt to fire
            prompt: {
              type: "string",
              description:
                "The complete MCSLA prompt for Veo (Subject → Action → Setting → Camera → Lighting → Audio → Locks). 80-140 words. Include dialog with quotes, fitted to 8s beat math.",
            },
            // Optional caption to save alongside
            caption: { type: "string", description: "Short Malay TikTok caption with 2-4 hashtags." },
          },
          required: ["scene", "persona", "hook", "structure", "cta", "voice", "gender", "prompt"],
        },
      },
      duration: { type: "string", enum: ["8"], default: "8" },
      aspect_ratio: { type: "string", default: "9:16" },
    },
    required: ["product_description", "variants"],
  },
  handler: async (args, ctx) => {
    const variants = Array.isArray(args.variants) ? args.variants : [];
    if (variants.length === 0) {
      return { ok: false, error: "No variants provided" };
    }

    // Resolve product image URL — agent's args > state.last_attached_image_url
    const productImageUrl =
      args.product_image_url || ctx.state.last_attached_image_url || "";

    // Build the final prompts (with voice line + locks injected)
    const prepared = variants.map((v: any) => {
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
      const voiceLine = voiceMap[v.voice] || undefined;
      return {
        scene: v.scene,
        persona: v.persona,
        hook: v.hook,
        structure: v.structure,
        cta: v.cta,
        voice: v.voice,
        gender: v.gender,
        hijab: v.hijab,
        age: v.age,
        caption: v.caption || "",
        prompt: withLocks(v.prompt || "", voiceLine),
      };
    });

    // Estimate cost
    const ratePerVideo = await priceFor(ctx.userId, "video_8s");
    const totalCost = ratePerVideo * prepared.length;

    // Save to state so the confirm-and-fire endpoint can find them
    ctx.state.pending_ugc_batch = {
      product_image_url: productImageUrl,
      product_description: args.product_description,
      duration: args.duration || "8",
      aspect_ratio: args.aspect_ratio || "9:16",
      variants: prepared,
    };

    // Return confirmation payload — frontend renders editable dialog
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

// recall_starred_prompts — agent reads user's starred history for memory
const recallStarredPrompts: ToolDefinition = {
  name: "recall_starred_prompts",
  description:
    "Read the user's starred saved prompts so you can vary them or recreate. Use when user says 'make 3 more like the gym one' or references a past win.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", default: 5 },
      bucket: {
        type: "string",
        enum: ["ugc"],
        default: "ugc",
        description: "Always 'ugc' for this agent.",
      },
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

// get_credits — agent checks balance before suggesting big batches
const getCredits: ToolDefinition = {
  name: "get_credits",
  description:
    "Get the user's current credit balance + plan. Use this before suggesting batches > 5 videos to avoid unaffordable suggestions.",
  parameters: {
    type: "object",
    properties: {},
  },
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

export const UGC_TOOLS: ToolDefinition[] = [
  generateUgcVariants,
  recallStarredPrompts,
  getCredits,
];

// ──────────────────────────────────────────────────────────────────────────
// confirmAndFireUgc — called by /api/agent/ugc/confirm after user clicks
// "Generate" in the confirmation dialog. Fires N Veo r2v jobs in parallel.
// ──────────────────────────────────────────────────────────────────────────

export async function confirmAndFireUgc(opts: {
  userId: string;
  projectId: string | null;
  conversationId: string;
  // Edited params from the user (may differ from what the agent proposed)
  product_image_url: string;
  product_description: string;
  duration: string;
  aspect_ratio: string;
  variants: Array<{
    scene: string;
    persona: string;
    hook: string;
    structure: string;
    cta: string;
    voice: string;
    gender: string;
    hijab?: string;
    age?: string;
    prompt: string;
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

  const ratePerVideo = await priceFor(opts.userId, "video_8s");
  const totalCost = ratePerVideo * variants.length;
  if (!(await hasEnoughCredits(opts.userId, totalCost))) {
    return {
      ok: false,
      error: `Kredit tak cukup. Perlu RM ${totalCost.toFixed(2)}.`,
    };
  }

  const cfg = await getP2Config();
  const admin = createAdminClient();
  const histories: any[] = [];

  await Promise.all(
    variants.map(async (v, idx) => {
      const refImage = opts.product_image_url;
      const useIngredient = !!refImage;
      const model = useIngredient ? cfg.videoR2V : cfg.videoT2V;

      const created = await p2CreateTask({
        model,
        prompt: v.prompt,
        imageUrls: refImage ? [refImage] : [],
        durationMode: opts.duration === "16" ? "16" : "8",
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
          prompt: v.prompt,
          caption: v.caption || "",
          framework: `${v.scene}/${v.persona}/${v.hook}/${v.structure}/${v.cta}`,
          reference_url: refImage || null,
          task_id: created.task_id || null,
          duration: opts.duration === "16" ? 16 : 8,
          cost: ratePerVideo,
          error_message: created.ok ? null : created.error || "P2 create failed",
          metadata: {
            idx,
            model,
            agent: "ugc",
            conversation_id: opts.conversationId,
            scene: v.scene,
            persona: v.persona,
            hook: v.hook,
            structure: v.structure,
            cta: v.cta,
            voice: v.voice,
            gender: v.gender,
            hijab: v.hijab,
            age: v.age,
            imageMode: useIngredient ? "ingredient" : "text",
            aspectRatio: opts.aspect_ratio,
          },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );

  // Audit log
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
