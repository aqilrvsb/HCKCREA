import { NextResponse, after } from "next/server";
import { validateMcpKey, validateMcpKeyString, mcpCallerId, getOrCreateGptProjectId } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasEnoughCredits } from "@/lib/deduct";
import { getGeminiRate, getGrokRate } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";

// POST /api/mcp/generate/video — MCP-triggered video generation.
//
// Since 2026-11-20 every video runs on ToAPIs (cascade slot "p10"), so the MCP
// offers exactly the two models the app sells:
//   gemini (alias omni) → Gemini Omni 1.2 Flash, fixed 15 s, 720p, flat price
//                         per video (rate_gemini)
//   grok                → Grok Video 1.5, 1–15 s (default 10), 720p, priced
//                         per second (rate_grok)
// Both accept image_mode text | frame | ingredient. Retired models (veo, sora2,
// seedance) and video_url references get a clear 400 instead of a silent swap.
// The poll-pending cron settles the row (polls ToAPIs, re-hosts to B2,
// deducts); /api/mcp/status/:id just reads it.

export const dynamic = "force-dynamic";

type ModelChoice = "gemini" | "grok";

const RETIRED = new Set(["veo", "veo3", "veo-3", "sora2", "sora-2", "seedance"]);
const MODEL_HELP = "Available video models: 'gemini' (Omni 1.2, fixed 15s) or 'grok' (Grok 1.5, 1-15s).";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Accept the key from the body (custom-GPT flow: /api/mcp/login returns it
  // and the model passes it as a param) OR the Authorization header (npm
  // package / direct API). Body key wins when present.
  const bodyKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  const auth = bodyKey ? await validateMcpKeyString(bodyKey) : await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const prompt = String(body?.prompt || "").trim().substring(0, 4000);
  const requestedModel = String(body?.model || "").trim().toLowerCase();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && /^https?:\/\//i.test(x))
    : [];
  const aspectRatio = String(body?.aspect_ratio || "") === "16:9" ? "16:9" : "9:16";
  const imageMode: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame"
        ? "frame"
        : "text";

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (RETIRED.has(requestedModel)) {
    return NextResponse.json(
      { error: `Model '${requestedModel}' is no longer available. ${MODEL_HELP}` },
      { status: 400 }
    );
  }
  if (String(body?.video_url || "").trim()) {
    return NextResponse.json(
      { error: "video_url (video reference) is no longer supported — use image_urls with image_mode frame or ingredient." },
      { status: 400 }
    );
  }
  if (imageMode !== "text" && imageUrls.length === 0) {
    return NextResponse.json(
      { error: `image_mode '${imageMode}' needs at least one image_urls entry.` },
      { status: 400 }
    );
  }

  let modelChoice: ModelChoice;
  if (!requestedModel || requestedModel === "gemini" || requestedModel === "omni" || requestedModel.startsWith("gemini-omni") || requestedModel.startsWith("omni-")) {
    modelChoice = "gemini";
  } else if (requestedModel === "grok" || requestedModel.startsWith("grok-")) {
    modelChoice = "grok";
  } else {
    return NextResponse.json({ error: `Unknown model '${requestedModel}'. ${MODEL_HELP}` }, { status: 400 });
  }

  const duration =
    modelChoice === "gemini"
      ? 15
      : Math.min(15, Math.max(1, Math.round(Number(body?.duration) || 10)));
  const resolution = "720p";

  // Ref-image caps per ToAPIs: Omni frame = first(+last) frame, ingredient ≤5;
  // Grok frame = first frame, ingredient (reference_images) ≤7.
  const imgs =
    imageMode === "text" ? []
      : imageMode === "frame" ? imageUrls.slice(0, modelChoice === "gemini" ? 2 : 1)
      : imageUrls.slice(0, modelChoice === "gemini" ? 5 : 7);

  const cost =
    modelChoice === "gemini"
      ? Number((await getGeminiRate("10")).toFixed(4)) // flat per Omni video
      : Number(((await getGrokRate()) * duration).toFixed(4));

  // Pre-flight funds check
  const hasFunds = await hasEnoughCredits(auth.userId, cost);
  if (!hasFunds) {
    const admin = createAdminClient();
    const { data: p } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", auth.userId)
      .maybeSingle();
    return NextResponse.json(
      { error: "Insufficient credits", balance: Number(p?.credits ?? 0), needed: cost },
      { status: 402 }
    );
  }

  const primaryModel = modelChoice === "gemini" ? "google/gemini-omni" : "grok-video-1.5";
  const baseMeta = {
    imageMode,
    resolution,
    aspectRatio,
    cinemaProvider: "toapis",
    modelChoice,
    featureType: "original-video",
    image_urls: imgs,
    mcp_caller_id: mcpCallerId(auth.keyPrefix),
  };

  // Insert placeholder row. MCP/GPT videos are filed under the client's auto
  // "GPT" project → they show in that project's Original Video history.
  const admin = createAdminClient();
  const gptProjectId = await getOrCreateGptProjectId(auth.userId);
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: auth.userId,
      project_id: gptProjectId,
      type: "video",
      tab: "original-video",
      status: "pending",
      prompt,
      reference_url: imgs[0] || null,
      task_id: null,
      duration,
      cost,
      metadata: { ...baseMeta, upload_status: "queued", model: primaryModel },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  }
  const historyId = hist.id;

  // Background fire — ToAPIs via the video cascade (p10 main + p10 fallbacks).
  after(async () => {
    try {
      const result = await generateVideoWithCascade({
        primaryModel,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode,
        asset: modelChoice,
      });

      if (result.ok) {
        await admin.from("history").update({
          task_id: result.taskId,
          metadata: {
            ...baseMeta,
            upload_status: "done",
            model: result.actualModel,
            provider: result.actualProvider,
            slot: result.actualSlot,
            ...(result.keyIndex !== undefined ? { p6_key_index: result.keyIndex } : {}),
            fallback_used: result.fallbackUsed,
            tier_log: result.tierLog,
          },
        }).eq("id", historyId);
      } else {
        await admin.from("history").update({
          status: "failed",
          error_message: result.error,
          metadata: { ...baseMeta, upload_status: "failed", tier_log: result.tierLog },
        }).eq("id", historyId);
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({ status: "failed", error_message: e?.message || "Background error" })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    task_id: historyId,
    estimated_cost: cost,
    model: modelChoice,
    duration,
  });
}
