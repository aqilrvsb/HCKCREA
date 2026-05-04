import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgentTurn, loadConversation, clearConversation } from "@/lib/agent";
import { UGC_SYSTEM_PROMPT, UGC_TOOLS } from "@/lib/agent-ugc";

// Edge runtime: longer timeout for streaming + agent loops with tool calls
// can take 15-40s. Edge gives us 300s ceiling.
export const runtime = "nodejs"; // Keep nodejs since lib/p2 + admin client need full Node APIs
// V3.2 latency p50 ~8s, agent loop = 2 round trips + tool exec, complex
// schemas can push past 60s. Vercel Pro allows up to 300s on Node runtime.
export const maxDuration = 180;
export const dynamic = "force-dynamic";

// GET /api/agent/ugc/chat?project_id=
// Returns the persisted conversation for (current user, project, ugc).
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id") || null;

  const conv = await loadConversation(user.id, projectId, "ugc");
  return NextResponse.json({
    ok: true,
    conversation_id: conv.id,
    messages: conv.messages,
    state: conv.state,
    total_messages: conv.total_messages,
  });
}

// POST /api/agent/ugc/chat
// Body: { project_id, message, image_url? }
// Runs one turn of the agent loop (LLM + tool calls) and returns the reply
// + any UI payloads (confirmation dialogs / generation_started cards).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = body?.project_id ? String(body.project_id) : null;
  const userText = String(body?.message || "").trim();
  let attachedImageUrl = body?.image_url ? String(body.image_url) : "";
  // Three roles now:
  //   "product"   — skip vision pass, agent uses image as r2v product ref
  //   "character" — same idea but for character/persona: same face / hair
  //                 / wardrobe locked across all generated scenes. Agent
  //                 should mention "use this image as character" so the
  //                 prompt-builder anchors the protagonist on the photo.
  //   "general"   — existing behaviour with vision describe (moodboard,
  //                 brand doc, mid-conversation reference)
  const imageRole: "general" | "product" | "character" =
    body?.image_role === "product"
      ? "product"
      : body?.image_role === "character"
        ? "character"
        : "general";
  // Optional plain-text USP / description the user typed alongside a
  // product reference. Surfaced into the agent's user turn so the LLM
  // has explicit context (price, claims, audience) on top of the image.
  const productUsp = String(body?.product_usp || "").trim();

  if (!userText && !attachedImageUrl) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  // Fold the role + USP into the user message so the agent sees it.
  // Front-loaded with a clear marker so the LLM can recognise the
  // structure across turns.
  //
  // Role rules per user spec:
  //   • product attached  → "use this image as product reference"
  //   • character attached → "use this image as character reference"
  //   • neither attached → text-to-video flow (no image ref note)
  let finalUserText = userText;
  if (imageRole === "product" && attachedImageUrl) {
    finalUserText = productUsp
      ? `[Use this image as PRODUCT reference. USP / description:\n${productUsp}\n]\n\n${userText}`
      : `[Use this image as PRODUCT reference.]\n\n${userText}`;
  } else if (imageRole === "character" && attachedImageUrl) {
    finalUserText = `[Use this image as CHARACTER reference — lock the SAME face, hair, and wardrobe across every generated scene / segment. Do not invent a new persona.]\n\n${userText}`;
  }

  // If user uploaded a data: URL, host it via /api/upload/image first so the
  // vision pass + downstream Veo r2v can use a public URL.
  if (attachedImageUrl.startsWith("data:")) {
    try {
      const blob = await (await fetch(attachedImageUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "agent-attach.png");
      const uploadRes = await fetch(`${url(req).origin}/api/upload/image`, {
        method: "POST",
        body: fd,
        headers: {
          // Forward auth so the upload endpoint sees the same user
          cookie: req.headers.get("cookie") || "",
        },
      });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (uploadRes.ok && uploadJson?.url) {
        attachedImageUrl = uploadJson.url;
      } else {
        // Fall through — attached image will be silently dropped if upload fails
        attachedImageUrl = "";
      }
    } catch {
      attachedImageUrl = "";
    }
  }

  const result = await runAgentTurn({
    userId: user.id,
    projectId,
    tab: "ugc",
    systemPrompt: UGC_SYSTEM_PROMPT,
    tools: UGC_TOOLS,
    userText: finalUserText,
    attachedImageUrl: attachedImageUrl || undefined,
    attachedImageRole: imageRole,
    attachedProductUsp: imageRole === "product" ? productUsp : undefined,
    attachedCharacterImageUrl:
      imageRole === "character" && attachedImageUrl ? attachedImageUrl : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Agent failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    reply: result.reply,
    ui_payloads: result.uiPayloads || [],
    conversation_id: result.conversationId,
  });
}

// DELETE /api/agent/ugc/chat?project_id=
// Wipe the conversation and start fresh.
export async function DELETE(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const projectId = u.searchParams.get("project_id") || null;
  await clearConversation(user.id, projectId, "ugc");
  return NextResponse.json({ ok: true });
}

// Helper — build a URL helper since Edge / Node both need this
function url(req: Request): URL {
  return new URL(req.url);
}
