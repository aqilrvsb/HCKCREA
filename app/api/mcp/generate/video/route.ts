import { NextResponse, after } from "next/server";
import { validateMcpKey, validateMcpKeyString, mcpCallerId, getOrCreateGptProjectId } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config, getCinemaRate, getVeoRate, getGeminiRate, getSeedanceRate, getSetting } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";

// POST /api/mcp/generate/video — MCP-triggered video generation.
//
// Reuses the cinema route's cascade dispatch logic but with:
//   1. API-key auth instead of session
//   2. Explicit pre-flight credit check
//   3. mcp_caller_id stamped for audit
//   4. Accepts model name directly (veo / sora2 / gemini / seedance / grok)
//
// Model → cascade asset mapping (same as cinema route):
//   veo / unset → "video"  (cfg.videoT2V / I2V / R2V)
//   sora2       → "sora2"
//   gemini      → "gemini"
//   seedance    → "cinema"
//   grok        → "grok"

export const dynamic = "force-dynamic";

type ModelChoice = "veo" | "sora2" | "gemini" | "seedance" | "grok";

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
  const prompt = String(body?.prompt || "").trim().substring(0, 5000);
  const requestedModel = String(body?.model || "").trim().toLowerCase();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x)
    : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const imageMode: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame"
        ? "frame"
        : "text";

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const modelChoice: ModelChoice =
    requestedModel === "sora2" ? "sora2" :
    requestedModel === "gemini" ? "gemini" :
    requestedModel === "seedance" ? "seedance" :
    requestedModel === "grok" ? "grok" :
    "veo";

  // Per-provider duration validation (same as cinema route)
  const duration =
    modelChoice === "veo" ? 8 :
    modelChoice === "sora2" ? (body?.duration === 12 || body?.duration === "12" ? 12 : 8) :
    modelChoice === "gemini" ? 10 :
    modelChoice === "seedance"
      ? Math.min(15, Math.max(4, Math.round(Number(body?.duration || 5))))
      : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));

  // Resolution: Gemini fixed 1080p, others default 720p
  const resolution =
    modelChoice === "gemini" ? "1080p"
      : (body?.resolution === "480p" ? "480p" : "720p");

  // Pre-flight cost calculation
  let cost = 0;
  if (modelChoice === "veo") {
    cost = Number((await getVeoRate("8")).toFixed(4));
  } else if (modelChoice === "sora2") {
    const setting = await getSetting<{ rate: number }>("sora2_rate");
    const cinemaRate = await getCinemaRate();
    const ratePerSec = typeof setting?.rate === "number" ? setting.rate : cinemaRate * 2;
    cost = Number((ratePerSec * duration).toFixed(4));
  } else if (modelChoice === "gemini") {
    cost = Number((await getGeminiRate("10")).toFixed(4));
  } else if (modelChoice === "seedance") {
    cost = Number(((await getSeedanceRate()) * duration).toFixed(4));
  } else {
    // grok
    cost = Number(((await getCinemaRate()) * duration).toFixed(4));
  }

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
      {
        error: "Insufficient credits",
        balance: Number(p?.credits ?? 0),
        needed: cost,
      },
      { status: 402 }
    );
  }

  // Insert placeholder row. GPT-generated videos are filed under the
  // client's auto "GPT" project → they show in that project's Original
  // Video history (tab='original-video').
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
      reference_url: imageUrls[0] || null,
      task_id: null,
      duration,
      cost,
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo" ? "veo" :
          modelChoice === "sora2" ? "apipod" :
          modelChoice === "gemini" ? "crun" :
          modelChoice === "seedance" ? "bytedance" :
          "grok-imagine",
        modelChoice,
        featureType: "original-video",
        image_urls: imageUrls,
        upload_status: "queued",
        mcp_caller_id: mcpCallerId(auth.keyPrefix),
        ...(modelChoice === "sora2" ? { model: "sora-2-vip", sora2Provider: "apipod" } : {}),
        ...(modelChoice === "gemini" ? { model: "google/gemini-omni" } : {}),
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }
  const historyId = hist.id;

  // Background fire — resolves model id, fires cascade, updates row.
  after(async () => {
    try {
      const cfg = await getP2Config();
      let model: string;
      if (modelChoice === "veo") {
        model = imageMode === "ingredient" ? cfg.videoR2V
          : imageMode === "frame" ? cfg.videoI2V
          : cfg.videoT2V;
      } else if (modelChoice === "sora2") {
        model = "sora2";
      } else if (modelChoice === "gemini") {
        model = "google/gemini-omni";
      } else if (modelChoice === "seedance") {
        model = "seedance"; // p2/p6 adapters auto-resolve t2v/i2v/r2v
      } else {
        model = imageMode !== "text" ? cfg.grokI2V : cfg.grokT2V;
      }

      const imgs = imageMode === "text" ? []
        : modelChoice === "sora2" ? imageUrls.slice(0, 1)
        : modelChoice === "seedance" ? imageUrls.slice(0, 5)
        : imageUrls.slice(0, 3);

      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode,
        asset:
          modelChoice === "grok" ? "grok" :
          modelChoice === "sora2" ? "sora2" :
          modelChoice === "gemini" ? "gemini" :
          modelChoice === "seedance" ? "cinema" :
          "video",
      });

      if (result.ok) {
        await admin.from("history").update({
          task_id: result.taskId,
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo" ? "veo" :
              modelChoice === "sora2" ? "apipod" :
              modelChoice === "gemini" ? "crun" :
              modelChoice === "seedance" ? "bytedance" :
              "grok-imagine",
            modelChoice,
            featureType: "original-video",
            image_urls: imageUrls,
            upload_status: "done",
            mcp_caller_id: mcpCallerId(auth.keyPrefix),
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
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo" ? "veo" :
              modelChoice === "sora2" ? "apipod" :
              modelChoice === "gemini" ? "crun" :
              modelChoice === "seedance" ? "bytedance" :
              "grok-imagine",
            modelChoice,
            featureType: "original-video",
            image_urls: imageUrls,
            upload_status: "failed",
            mcp_caller_id: mcpCallerId(auth.keyPrefix),
            tier_log: result.tierLog,
          },
        }).eq("id", historyId);
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
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
