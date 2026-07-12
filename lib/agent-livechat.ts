// Pening Lab Live — the native livechat agent for the Original Video tab.
//
// A 100% port of the "Pening Lab GPT" custom GPT into an in-app agent (see
// PENINGLAB_GPT_MASTER_DOCUMENTATION §12). Same brain, same flow, but the
// ChatGPT workarounds become real code:
//   • No login tool — the client is already session-authenticated.
//   • Storyboard grid → generate_image (gpt-image-2), rendered inline.
//   • Video → generate_video (Omni / gemini, fixed 10s, image_mode ingredient).
//   • get_video_status polls the render and returns the two links.
//
// The system prompt (adapted instructions + the full 59KB Expert Playbook) is
// CONFIDENTIAL and lives in app_settings.livechat_system_prompt — never in git.

import type { ToolDefinition } from "@/lib/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, getGeminiRate } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";
import { generateVideoWithCascade } from "@/lib/video-cascade";
import { settleHistoryRow } from "@/lib/settle";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { mcpDownloadToken } from "@/lib/mcp-auth";

// Storyboard image engine — user picked gpt-image-2 (not nano-banana-pro).
const STORYBOARD_MODEL = "gpt-image-2";

// ──────────────────────────────────────────────────────────────────────────
// System prompt — loaded from the DB (confidential; kept out of git).
// ──────────────────────────────────────────────────────────────────────────

const FALLBACK_PROMPT =
  "You are Pening Lab Live, Malaysia's AI creative marketing studio for product ads. " +
  "The client is already logged in. Ask them to pick a saved product (Beg Kuning affiliate or Tiada Link manual), " +
  "then ask MAIN category (UGC / Product Commercial), then the sub-style, then generate ONE storyboard grid image " +
  "per video via generate_image, get approval, then render the video via generate_video (Omni). Reply in casual Malay.";

export async function loadLivechatSystemPrompt(): Promise<string> {
  const s = await getSettings(["livechat_system_prompt"]);
  const text = s.livechat_system_prompt?.text;
  return typeof text === "string" && text.length > 200 ? text : FALLBACK_PROMPT;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll a pending history row to completion, driving settlement ourselves so
// the storyboard/video URL materialises inline (settleHistoryRow polls the
// provider + rehosts the output to B2). Returns the final output_url, or null
// on failure/timeout.
async function pollRowDone(
  admin: ReturnType<typeof createAdminClient>,
  historyId: string,
  maxMs: number
): Promise<{ ok: boolean; outputUrl?: string; error?: string }> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { data: row } = await admin
      .from("history")
      .select("*")
      .eq("id", historyId)
      .maybeSingle();
    if (!row) return { ok: false, error: "row vanished" };
    if (row.status === "done" && row.output_url) {
      return { ok: true, outputUrl: row.output_url };
    }
    if (row.status === "failed") {
      return { ok: false, error: row.error_message || "render failed" };
    }
    try {
      await settleHistoryRow(row as any);
    } catch {
      // transient — retry next loop
    }
    await sleep(2500);
  }
  return { ok: false, error: "timeout" };
}

function downloadUrlFor(historyId: string): string {
  try {
    return `/api/mcp/download/${historyId}?t=${mcpDownloadToken(historyId)}`;
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tools
// ──────────────────────────────────────────────────────────────────────────

const getCredits: ToolDefinition = {
  name: "get_credits",
  description:
    "Get the client's RM credit balance, plan and days left. Call at the start of the chat and after each finished video.",
  parameters: { type: "object", properties: {} },
  handler: async (_args, ctx) => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("credits, plan, plan_expires_at")
      .eq("id", ctx.userId)
      .maybeSingle();
    if (!data) return { ok: false, error: "Profile not found" };
    const daysLeft = data.plan_expires_at
      ? Math.max(
          0,
          Math.ceil((new Date(data.plan_expires_at).getTime() - Date.now()) / 86_400_000)
        )
      : 0;
    return {
      ok: true,
      kind: "info",
      summary: `Balance: RM ${Number(data.credits).toFixed(2)} · Plan: ${data.plan} · ${daysLeft} days left`,
    };
  },
};

const generateStoryboardImage: ToolDefinition = {
  name: "generate_image",
  description:
    "Render ONE 9:16 storyboard GRID image (6–9 panels) for ONE video, using gpt-image-2. " +
    "The prompt MUST begin with the literal sentence 'ONE single 9:16 storyboard grid for ONE video only.' " +
    "Pass the client's product reference image URL(s) so the product identity is locked. " +
    "This BLOCKS until the image is ready and returns its URL — show it to the client inline, then ask ✅ OK / 🔁 sub lain / 🎬 Submit video. " +
    "NEVER put more than one storyboard in one image (campaign = one call per video).",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "The full storyboard image prompt. MUST start with 'ONE single 9:16 storyboard grid for ONE video only.' " +
          "Describe the 6–9 panels (hook → beats → CTA) for this ONE video's sub-style, full-bleed grid, no headers/numbers/timecodes.",
      },
      product_image_urls: {
        type: "array",
        items: { type: "string" },
        description:
          "Public URL(s) of the client's product reference image(s) so the storyboard locks the exact product. Use the loaded product's images.",
      },
    },
    required: ["prompt"],
  },
  handler: async (args, ctx) => {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) return { ok: false, error: "Empty storyboard prompt" };

    const productImages: string[] = [
      ...(Array.isArray(args.product_image_urls) ? args.product_image_urls : []),
      ...(Array.isArray(ctx.state.product_image_urls) ? ctx.state.product_image_urls : []),
    ]
      .filter((u: any) => typeof u === "string" && u.trim())
      .slice(0, 3);

    const admin = createAdminClient();
    const cost = await priceFor(ctx.userId, "image_generate", "gpt_image");
    if (!(await hasEnoughCredits(ctx.userId, cost))) {
      return { ok: false, error: `Kredit tak cukup untuk storyboard (perlu RM ${cost.toFixed(2)}).` };
    }

    const { data: hist, error: insErr } = await admin
      .from("history")
      .insert({
        user_id: ctx.userId,
        project_id: ctx.projectId,
        type: "image",
        tab: "image",
        status: "pending",
        prompt,
        reference_url: productImages[0] || null,
        cost,
        metadata: {
          agent: "livechat",
          conversation_id: ctx.conversationId,
          image_model: STORYBOARD_MODEL,
          kind: "storyboard",
          aspectRatio: "9:16",
          image_urls: productImages,
          upload_status: "queued",
        },
      })
      .select("id, metadata")
      .single();
    if (insErr || !hist) return { ok: false, error: "Storyboard row insert failed" };

    const result = await generateImageWithCascade({
      primaryModel: STORYBOARD_MODEL,
      prompt,
      aspectRatio: "9:16",
      imageUrls: productImages.length > 0 ? productImages : undefined,
    });
    if (!result.ok) {
      await admin
        .from("history")
        .update({ status: "failed", error_message: result.error })
        .eq("id", hist.id);
      return { ok: false, error: `Storyboard gagal: ${result.error}` };
    }
    await admin
      .from("history")
      .update({
        task_id: result.taskId,
        metadata: {
          ...(hist.metadata || {}),
          provider: result.actualProvider,
          slot: result.actualSlot,
          model: result.actualModel,
        },
      })
      .eq("id", hist.id);

    const done = await pollRowDone(admin, hist.id, 150_000);
    if (!done.ok || !done.outputUrl) {
      return { ok: false, error: `Storyboard tak siap: ${done.error || "timeout"}` };
    }

    return {
      ok: true,
      kind: "fired",
      summary:
        `Storyboard READY. image_url = ${done.outputUrl} (history ${hist.id}). ` +
        `POST-CHECK: if it shows 2+ storyboards/columns, discard & regenerate. Otherwise present it to the client ` +
        `and ask ✅ OK / 🔁 sub lain / 🎬 Submit video. When rendering the video, pass THIS url as image_urls[0] (the storyboard) ` +
        `plus the product image as image_urls[1].`,
      ui: { type: "storyboard_ready", history_id: hist.id, image_url: done.outputUrl },
      historyIds: [hist.id],
      cost,
    };
  },
};

const generateOmniVideo: ToolDefinition = {
  name: "generate_video",
  description:
    "Submit ONE video render on the Omni engine (fixed 10s, 1080p, 9:16, image_mode ingredient). " +
    "image_urls[0] = the approved storyboard grid, image_urls[1] = the product photo (role-split). " +
    "The prompt MUST list every panel with second-ranges + verbatim captions (BEAT LIST), and lock the product label. " +
    "Returns a task_id; then AUTO-POLL get_video_status until done. For a campaign, call this for EACH approved video first, then poll each.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Full Omni video prompt with the mandatory BEAT LIST (0.0–1.5s (panel 1): action … caption '…', …), role-split " +
          "(image 1 = storyboard blueprint, image 2 = product ground-truth label), CRITICAL OPENING (open on live action, never show the grid), " +
          "anti-gibberish captions (short real words), and Malay VO.",
      },
      image_urls: {
        type: "array",
        items: { type: "string" },
        description: "1–2 public URLs: [storyboard_url, product_url]. Storyboard first.",
      },
      label: {
        type: "string",
        description: "Short label for this video (e.g. 'Video 1 · UGC Unboxing') for campaign tracking.",
      },
    },
    required: ["prompt", "image_urls"],
  },
  handler: async (args, ctx) => {
    const prompt = String(args.prompt || "").trim();
    const imageUrls: string[] = (Array.isArray(args.image_urls) ? args.image_urls : [])
      .filter((u: any) => typeof u === "string" && u.trim())
      .slice(0, 2);
    if (!prompt) return { ok: false, error: "Empty video prompt" };
    if (imageUrls.length === 0) {
      return { ok: false, error: "Omni needs at least the storyboard image_url — generate the storyboard first." };
    }

    const duration = 10; // Omni fixed 10s
    const cost = Number((await getGeminiRate("10")).toFixed(4));
    if (!(await hasEnoughCredits(ctx.userId, cost))) {
      return { ok: false, error: `Kredit tak cukup untuk video (perlu RM ${cost.toFixed(2)}). Top up dulu.` };
    }

    const admin = createAdminClient();
    const { data: hist, error: insErr } = await admin
      .from("history")
      .insert({
        user_id: ctx.userId,
        project_id: ctx.projectId,
        type: "video",
        tab: "original-video",
        status: "pending",
        prompt,
        reference_url: imageUrls[0],
        duration,
        cost: 0,
        metadata: {
          agent: "livechat",
          conversation_id: ctx.conversationId,
          model: "google/gemini-omni",
          modelChoice: "gemini",
          cinemaProvider: "crun",
          imageMode: "ingredient",
          resolution: "1080p",
          aspectRatio: null,
          image_urls: imageUrls,
          featureType: "original-video",
          label: args.label || null,
          upload_status: "queued",
        },
      })
      .select("id, metadata")
      .single();
    if (insErr || !hist) return { ok: false, error: "Video row insert failed" };

    const r = await generateVideoWithCascade({
      primaryModel: "google/gemini-omni",
      userId: ctx.userId,
      prompt,
      imageUrls,
      imageMode: "ingredient",
      durationMode: "10",
      aspectRatio: "9:16",
      asset: "gemini",
    });
    if (!r.ok) {
      await admin
        .from("history")
        .update({ status: "failed", error_message: r.error, cost })
        .eq("id", hist.id);
      return { ok: false, error: `Video submit gagal: ${r.error}` };
    }
    await admin
      .from("history")
      .update({
        task_id: r.taskId,
        cost,
        metadata: {
          ...(hist.metadata || {}),
          provider: r.actualProvider,
          slot: r.actualSlot,
          ...(typeof (r as any).keyIndex === "number" ? { p6_key_index: (r as any).keyIndex } : {}),
          model: r.actualModel,
          fallback_used: r.fallbackUsed,
          tier_log: r.tierLog,
        },
      })
      .eq("id", hist.id);

    return {
      ok: true,
      kind: "fired",
      summary:
        `Video SUBMITTED (${args.label ? args.label + ", " : ""}task_id ${hist.id}, RM ${cost.toFixed(2)}). ` +
        `It renders in the background. Tell the client it's rendering 🎬, then call get_video_status with task_id ${hist.id}. ` +
        `For a campaign: submit ALL videos first, THEN poll each one.`,
      ui: { type: "generation_started", history_ids: [hist.id], cost },
      historyIds: [hist.id],
      cost,
    };
  },
};

const getVideoStatus: ToolDefinition = {
  name: "get_video_status",
  description:
    "Poll a submitted video by task_id. When done, returns the watch link + download link + new balance — give BOTH links to the client. " +
    "If still pending, wait and call again. Auto-poll without waiting for the client to ask.",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task_id returned by generate_video." },
    },
    required: ["task_id"],
  },
  handler: async (args, ctx) => {
    const taskId = String(args.task_id || "").trim();
    if (!taskId) return { ok: false, error: "Missing task_id" };
    const admin = createAdminClient();
    let { data: row } = await admin
      .from("history")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!row) return { ok: false, error: "Task not found" };

    if (row.status === "pending") {
      try {
        await settleHistoryRow(row as any);
      } catch {
        /* transient */
      }
      const { data: fresh } = await admin
        .from("history")
        .select("*")
        .eq("id", taskId)
        .maybeSingle();
      if (fresh) row = fresh;
    }

    const { data: prof } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", ctx.userId)
      .maybeSingle();
    const bal = Number(prof?.credits || 0);

    if (row.status === "done" && row.output_url) {
      const dl = downloadUrlFor(row.id);
      return {
        ok: true,
        kind: "fired",
        summary:
          `Video DONE. ▶ Tonton: ${row.output_url}${dl ? ` · 📥 Download: ${dl}` : ""} · Baki: RM ${bal.toFixed(2)}. ` +
          `Give the client BOTH links.${bal < 5 ? " (Baki rendah — ingatkan top up.)" : ""}`,
        ui: { type: "video_ready", history_id: row.id, output_url: row.output_url, download_url: dl || undefined },
        historyIds: [row.id],
      };
    }
    if (row.status === "failed") {
      return {
        ok: true,
        kind: "info",
        summary: `Video FAILED: ${row.error_message || "unknown"}. Apply the RENDER FALLBACK ladder from the Playbook.`,
      };
    }
    return { ok: true, kind: "info", summary: `Video masih render (pending). Poll get_video_status lagi sekejap.` };
  },
};

export const LIVECHAT_TOOLS: ToolDefinition[] = [
  getCredits,
  generateStoryboardImage,
  generateOmniVideo,
  getVideoStatus,
];
