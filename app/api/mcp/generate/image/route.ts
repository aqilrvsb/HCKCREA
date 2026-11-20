import { NextResponse, after } from "next/server";
import { validateMcpKey, mcpCallerId, getOrCreateGptProjectId } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { generateImageWithCascade } from "@/lib/image-cascade";

// POST /api/mcp/generate/image — MCP-triggered image generation.
//
// Mirrors /api/generate/image's flow but with:
//   1. API-key auth (validateMcpKey instead of session cookie)
//   2. Pre-flight credit check (UI route skips because nav-gate blocks
//      it; MCP has no such gate so we check explicitly)
//   3. metadata.mcp_caller_id stamped for audit + admin/usage badge
//
// Reuses the same cascade + settle path so deduction happens
// identically to UI calls.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x).slice(0, 4)
    : [];
  const aspectRatio = String(body?.aspect_ratio || "1:1");

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // Since 2026-11-20 the MCP offers exactly two image models (owner's
  // choice): nano-banana-2.1 (default) and gpt-image-2.6. Both run on Grsai
  // (p4) first; other slots fall back to nano-banana-2 / gpt-image-2.
  const IMAGE_MODELS = ["nano-banana-2.1", "gpt-image-2.6"] as const;
  const raw = String(body?.model || "").trim().toLowerCase();
  const requestedModel: (typeof IMAGE_MODELS)[number] | null =
    !raw || raw === "banana" || raw === "nano-banana" || raw === "nano-banana-2.1" || raw === "gemini-nano-banana-2.1"
      ? "nano-banana-2.1"
      : raw === "gpt-image" || raw === "gpt-image-2.6"
        ? "gpt-image-2.6"
        : null;
  if (!requestedModel) {
    return NextResponse.json(
      { error: `Model '${raw}' is not available. Image models: ${IMAGE_MODELS.join(", ")}.` },
      { status: 400 }
    );
  }

  // Price hint — the same rate settle.ts charges for each family.
  const modelHint: "banana_pro" | "gpt_image" =
    requestedModel === "nano-banana-2.1" ? "banana_pro" : "gpt_image";

  // Pre-flight credit check. MCP has no nav gate so we must check
  // explicitly. UI route skips this because the dashboard blocks users
  // with credits < RM1 from reaching tabs.
  const cost = await priceFor(auth.userId, "image_generate", modelHint);
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

  // Insert placeholder row tagged with mcp_caller_id so admin/usage
  // can show the MCP badge.
  const admin = createAdminClient();
  const gptProjectId = await getOrCreateGptProjectId(auth.userId);
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: auth.userId,
      project_id: gptProjectId,
      type: "image",
      tab: "image",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] ?? null,
      task_id: null,
      cost,
      metadata: {
        aspectRatio,
        image_urls: imageUrls,
        upload_status: "queued",
        mcp_caller_id: mcpCallerId(auth.keyPrefix),
        model: requestedModel,
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

  // Background work — mirrors UI image route's after() block. Resolves
  // p2 config, fires cascade, updates row with task_id + actual model.
  after(async () => {
    try {
      const primaryModel = requestedModel;
      const result = await generateImageWithCascade({
        primaryModel,
        prompt,
        aspectRatio,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      });
      if (result.ok) {
        await admin
          .from("history")
          .update({
            task_id: result.taskId,
            metadata: {
              aspectRatio,
              image_urls: imageUrls,
              upload_status: "done",
              mcp_caller_id: mcpCallerId(auth.keyPrefix),
              model: result.actualModel,
              provider: result.actualProvider,
              slot: result.actualSlot,
              tier_log: result.tierLog,
            },
          })
          .eq("id", historyId);
      } else {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: result.error,
            metadata: {
              aspectRatio,
              image_urls: imageUrls,
              upload_status: "failed",
              mcp_caller_id: mcpCallerId(auth.keyPrefix),
              tier_log: result.tierLog,
            },
          })
          .eq("id", historyId);
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
    model: requestedModel,
  });
}
