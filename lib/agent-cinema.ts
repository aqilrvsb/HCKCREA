// Cinema Agent — Grok Imagine specialist for atmospheric / cinematic /
// hyper-motion content. Same skill-library architecture as UGC v2.
//
// Different from UGC: single generation per call (not batch of 10),
// duration is 6-30s slider (Grok native), descriptive paragraph prompt
// style (NOT MCSLA/bracket lists), atmospheric/director-driven knowledge.

import type { ToolDefinition } from "@/lib/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { p2CreateTask } from "@/lib/p2";
import { getCinemaRate, getP2Config } from "@/lib/settings";
import { hasEnoughCredits } from "@/lib/deduct";
import { renderSkillIndex } from "@/lib/skills/loader";
import { makeFetchSkillTool } from "@/lib/skills/fetch-tool";

// ──────────────────────────────────────────────────────────────────────────
// Slim orchestrator
// ──────────────────────────────────────────────────────────────────────────

const CINEMA_ORCHESTRATOR = `You are the Cinema Agent — atmospheric / cinematic / hyper-motion specialist powered by Grok Imagine.

ROLE
- Grok Imagine only (text-to-video + image-to-video). Duration 6-30 seconds (slider).
- Use cases: atmospheric mood, neon-noir, anime/Ghibli, surreal dream-logic, hyper motion product shots, cinematic narrative beats, director-style pieces.
- If user asks for affiliate UGC / talking-head / virtual try-on / Malaysian product testimonial → redirect to UGC tab (Veo 3.1 fast is the right tool there).
- If user asks for still images → redirect to Image tab.
- Off-topic → reply: "Saya specialist cinema sahaja — boleh tolong korang dengan video sinematik."

LANGUAGE — STRICT
- ALWAYS chat with the user in MALAY (Bahasa Melayu). Casual marketer tone.
  Code-switch English for technical terms only ("aspect ratio", "duration", "Grok", "shot switch").
  Never reply in pure English even if user writes English — read intent, reply in Malay.
- The Grok prompts you BUILD (after SUBMIT) are written in ENGLISH (Grok responds best to English).
  Malay phrasing inside dialog is fine if user wants Malay voice-over.

GOAL
- Make it EASY for the user to generate the highest-quality cinematic clip possible for marketing.
- You are their creative director — guide, suggest, dig.
- Each turn: summarize → suggest → ask. Keep digging until user is happy.
- Examples of follow-up questions:
  · "Vibe macam mana — neon-noir, Ghibli soft, atau hyper-motion?"
  · "Ada director reference — Wong Kar-wai, Villeneuve, Wes Anderson?"
  · "Duration berapa — 6s untuk hook, 15s untuk story?"
  · "Ada produk reference image nak attach atau pure text-to-video?"

GROK PROMPT STYLE (critical — different from Veo)
- Natural language sentences, NOT MCSLA bracket lists.
- 50-200 words. First 20-30 words weighted heaviest — lead with subject + action.
- Five-layer formula: Scene → Camera → Style/Lighting → Motion → Audio.
- Negatives ineffective — use positive alternatives ("sharp detail" not "no blur").
- Stability constraint optional at end ("Keep the face consistent").
- Custom mode REQUIRES Unfixed lens parameter for camera moves.

AVAILABLE TOOLS
1. fetch_skill({ id?, kind?, query? }) — load deep knowledge on directors/cameras/eras/film-stocks/moods/techniques. Fetch BEFORE writing prompts.
2. recall_starred_prompts({ limit }) — read user's starred past Cinema wins.
3. get_credits() — check balance before suggesting >20s clips.
4. generate_cinema_video({ prompt, image_url?, aspect_ratio, duration, image_mode }) — fire one Grok video. Returns confirmation dialog. User edits + fires.

CONVERSATION STYLE
- Default to SHORT Malay replies — 1-3 sentences. Macam chat dengan kawan.
- Each turn: summarize → suggest → ask. NEVER essay.
- DO NOT preemptively fetch skills or build prompts. The user sees your tool calls — spamming fetch_skill before SUBMIT looks busy and breaks the flow.
- "Cukup detail dah?" → user replies SUBMIT to lock in.

🚨 CRITICAL: NEVER call generate_cinema_video until the user message contains "SUBMIT" (any case)
- "buat lagi atmospheric" → just chat in Malay. NO tool call.
- "guna Wong Kar-wai vibe" → acknowledge ("Ok lock Wong Kar-wai — neon-noir handheld"), continue. NO tool call.
- "tunjuk apa kau nak buat" → describe rough idea in Malay. NO tool call.
- ONLY when user message includes "SUBMIT" / "submit" / "Submit" → THEN:
    1. Fetch the relevant skills (1 mood + 1 director + 1 camera + 1 technique)
    2. Build the final 50-200 word Grok prompt IN ENGLISH (model adherence)
    3. Call generate_cinema_video with requires_confirmation=true
    4. The frontend will render an inline Approve/Reject card — DO NOT describe it in chat.
- After SUBMIT and approval: reply ONE LINE in Malay: "Done — cinema clip tengah render, akan muncul kat History."
- After SUBMIT and rejection: ask in Malay what to revise. Wait for next SUBMIT.

WORKFLOW
- Phase 1 — Discover. User describes vibe/goal; you confirm + ask 1-2 questions in Malay.
- Phase 2 — Refine. User adds detail. You summarize + suggest. Malay only. NO TOOLS.
- Phase 3 — Submit. User types SUBMIT. NOW fetch skills + build ENGLISH Grok prompt + call generate_cinema_video.

HYPER MOTION (special)
Default Grok = slow motion. To unlock kinetic energy, use ADVERB INTENSITY:
"car passing" → "car passing quickly"
"wing flapping" → "wing flapping greatly"
Allowed modifiers: quickly, violently, with large amplitude, at high frequency, powerfully, wildly, rapidly, forcefully, explosively, thunderously, sprinting with all his strength, erupts into motion.
Suppressors to AVOID: slow motion, static tripod, locked frame, calm pacing, subtle, gentle.

DURATION + COST
- Cinema cost = duration_seconds × cinema_rate_per_sec (admin-set).
- For >15s clips, advise user that quality degrades after extension chains. Recommend split into 2-3 separate generations stitched in post for >15s storytelling.

SHOT SWITCH (multi-shot in single prompt)
For multi-shot in ONE Grok generation, use phrase "Shot Switch" with Unfixed lens:
"[Opening scene]. Shot Switch. [Close-up beat]. Shot Switch. [Closing beat]."

REPLIES: tight Malay. Approval inline in chat, not via popup.

SKILL INDEX (call fetch_skill with these ids)
{{SKILL_INDEX}}`;

export const CINEMA_SYSTEM_PROMPT = CINEMA_ORCHESTRATOR.replace(
  "{{SKILL_INDEX}}",
  renderSkillIndex("cinema")
);

// ──────────────────────────────────────────────────────────────────────────
// generate_cinema_video tool — single Grok video with confirmation
// ──────────────────────────────────────────────────────────────────────────

const generateCinemaVideo: ToolDefinition = {
  name: "generate_cinema_video",
  description:
    "Plan ONE cinematic video (Grok Imagine) and return a confirmation dialog. The user edits + fires from there. " +
    "Build the prompt from skills you've already fetched. Use natural-language sentences, NOT bracket lists. " +
    "50-200 words. Lead with subject + action.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "The complete Grok prompt — natural language paragraph(s), 50-200 words. " +
          "Lead with subject + action. Include camera, style/lighting, motion, audio in five-layer order. " +
          "For hyper motion, use adverb intensity. For multi-shot, use 'Shot Switch' phrase.",
      },
      image_mode: {
        type: "string",
        enum: ["text", "image"],
        default: "text",
        description: "'text' = text-to-video. 'image' = image-to-video using a reference (ctx.state.last_attached_image_url).",
      },
      image_url: {
        type: "string",
        description: "Public URL of reference image for i2v mode. Use ctx state if user attached earlier.",
      },
      aspect_ratio: {
        type: "string",
        enum: ["9:16", "16:9", "1:1", "4:3", "3:4", "3:2", "2:3"],
        default: "9:16",
      },
      duration: {
        type: "number",
        minimum: 6,
        maximum: 30,
        default: 8,
        description: "Duration in seconds (6-30). Default 8s. Quality degrades on chains >15s.",
      },
      mood_skill_id: {
        type: "string",
        description: "The mood skill id used to build this prompt (e.g. 'neon-noir'). Tracked for analytics.",
      },
      director_skill_id: {
        type: "string",
        description: "Optional director skill id used (e.g. 'wong-kar-wai').",
      },
      camera_skill_id: {
        type: "string",
        description: "Optional camera skill id used (e.g. 'dolly-in').",
      },
    },
    required: ["prompt"],
  },
  handler: async (args, ctx) => {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) return { ok: false, error: "Empty prompt" };
    const imageMode = args.image_mode === "image" ? "image" : "text";
    const imageUrl =
      imageMode === "image"
        ? String(args.image_url || ctx.state.last_attached_image_url || "")
        : "";
    if (imageMode === "image" && !imageUrl) {
      return {
        ok: false,
        error: "Image-to-video mode requires a reference image. Ask user to attach one.",
      };
    }
    const aspectRatio = String(args.aspect_ratio || "9:16");
    const duration = Math.min(30, Math.max(6, Math.round(Number(args.duration || 8))));

    const ratePerSec = await getCinemaRate();
    const cost = Number((ratePerSec * duration).toFixed(4));

    ctx.state.pending_cinema_clip = {
      prompt,
      image_url: imageUrl,
      image_mode: imageMode,
      aspect_ratio: aspectRatio,
      duration,
      mood_skill_id: args.mood_skill_id,
      director_skill_id: args.director_skill_id,
      camera_skill_id: args.camera_skill_id,
    };

    return {
      ok: true,
      kind: "requires_confirmation",
      summary: `Prepared 1 Cinema clip (${duration}s, ${aspectRatio}). Estimated cost RM ${cost.toFixed(
        2
      )}. Showing user the confirmation dialog now.`,
      ui: {
        type: "confirm_generation",
        bucket: "cinema",
        params: {
          prompt,
          image_url: imageUrl,
          image_mode: imageMode,
          aspect_ratio: aspectRatio,
          duration,
          mood_skill_id: args.mood_skill_id,
          director_skill_id: args.director_skill_id,
          camera_skill_id: args.camera_skill_id,
        },
        estimated_cost: cost,
      },
    };
  },
};

const recallStarredCinema: ToolDefinition = {
  name: "recall_starred_prompts",
  description:
    "Read user's starred past Cinema prompts. Call FIRST when user references prior work.",
  parameters: {
    type: "object",
    properties: { limit: { type: "number", default: 5 } },
  },
  handler: async (args, ctx) => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("saved_prompts")
      .select("id, prompt_text, scene_template, model, user_notes, created_at")
      .eq("user_id", ctx.userId)
      .eq("bucket", "cinema")
      .eq("starred", true)
      .order("created_at", { ascending: false })
      .limit(Math.min(20, Math.max(1, Number(args.limit || 5))));

    if (!data || data.length === 0) {
      return { ok: true, kind: "info", summary: "User has no starred Cinema prompts yet." };
    }
    const lines = data
      .map(
        (p: any, i: number) =>
          `${i + 1}. ${p.prompt_text.slice(0, 240)}${p.prompt_text.length > 240 ? "…" : ""}${p.user_notes ? `  (note: ${p.user_notes})` : ""}`
      )
      .join("\n");
    return { ok: true, kind: "info", summary: `Starred Cinema prompts (${data.length}):\n${lines}` };
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

export const CINEMA_TOOLS: ToolDefinition[] = [
  makeFetchSkillTool("cinema"),
  recallStarredCinema,
  getCredits,
  generateCinemaVideo,
];

// ──────────────────────────────────────────────────────────────────────────
// confirmAndFireCinema — called after user confirms the dialog
// ──────────────────────────────────────────────────────────────────────────

export async function confirmAndFireCinema(opts: {
  userId: string;
  projectId: string | null;
  conversationId: string;
  prompt: string;
  image_url: string;
  image_mode: "text" | "image";
  aspect_ratio: string;
  duration: number;
  mood_skill_id?: string;
  director_skill_id?: string;
  camera_skill_id?: string;
}): Promise<{ ok: boolean; history_id?: string; cost?: number; error?: string }> {
  const ratePerSec = await getCinemaRate();
  const duration = Math.min(30, Math.max(6, Math.round(opts.duration)));
  const cost = Number((ratePerSec * duration).toFixed(4));

  if (!(await hasEnoughCredits(opts.userId, cost))) {
    return { ok: false, error: `Kredit tak cukup. Perlu RM ${cost.toFixed(2)}.` };
  }

  const cfg = await getP2Config();
  const model = opts.image_mode === "image" ? cfg.grokI2V : cfg.grokT2V;
  if (!model) return { ok: false, error: "Cinema model not configured" };

  const created = await p2CreateTask({
    model,
    prompt: opts.prompt,
    imageUrls: opts.image_mode === "image" && opts.image_url ? [opts.image_url] : [],
    durationMode: String(duration),
    aspectRatio: opts.aspect_ratio,
    resolution: "720p",
    extra: { mode: "normal" },
  });

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .insert({
      user_id: opts.userId,
      project_id: opts.projectId,
      type: "video",
      tab: "cinema",
      status: created.ok && created.task_id ? "pending" : "failed",
      prompt: opts.prompt,
      reference_url: opts.image_url || null,
      task_id: created.task_id || null,
      duration,
      cost,
      error_message: created.ok ? null : created.error || "P2 create failed",
      metadata: {
        agent: "cinema",
        conversation_id: opts.conversationId,
        model,
        mood_skill_id: opts.mood_skill_id,
        director_skill_id: opts.director_skill_id,
        camera_skill_id: opts.camera_skill_id,
        imageMode: opts.image_mode,
        aspectRatio: opts.aspect_ratio,
      },
    })
    .select()
    .single();

  await admin.from("agent_actions").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    tab: "cinema",
    tool_name: "confirm_and_fire_cinema",
    params: { duration, aspect: opts.aspect_ratio, image_mode: opts.image_mode },
    outcome: "fired",
    history_ids: hist ? [hist.id] : [],
    cost,
  });

  return { ok: true, history_id: hist?.id, cost };
}
