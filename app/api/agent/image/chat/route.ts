import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgentTurn, loadConversation, clearConversation } from "@/lib/agent";
import { IMAGE_SYSTEM_PROMPT, IMAGE_TOOLS } from "@/lib/agent-image";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id") || null;
  const conv = await loadConversation(user.id, projectId, "image");
  return NextResponse.json({
    ok: true,
    conversation_id: conv.id,
    messages: conv.messages,
    state: conv.state,
    total_messages: conv.total_messages,
  });
}

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
  // "general" → default vision describe; "product" → skip vision (same as
  // ugc/cinema chat routes). On the image agent product attaches go through
  // banana-pro/gpt-image-2 as image-to-image references.
  const imageRole: "general" | "product" =
    body?.image_role === "product" ? "product" : "general";
  // User's explicit model pick from the dropdown next to the attach icons.
  // When set, the agent loop stores it on conversation state so the
  // generate_image tool uses it directly (skips banana-vs-gpt-2 decision
  // tree fetch — saves a tool call).
  const imageModelOverride: "nano-banana-pro" | "gpt-image-2" | null =
    body?.image_model === "gpt-image-2"
      ? "gpt-image-2"
      : body?.image_model === "nano-banana-pro"
        ? "nano-banana-pro"
        : null;

  if (!userText && !attachedImageUrl) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  if (attachedImageUrl.startsWith("data:")) {
    try {
      const blob = await (await fetch(attachedImageUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "agent-attach.png");
      const uploadRes = await fetch(`${new URL(req.url).origin}/api/upload/image`, {
        method: "POST",
        body: fd,
        headers: { cookie: req.headers.get("cookie") || "" },
      });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      attachedImageUrl = uploadRes.ok && uploadJson?.url ? uploadJson.url : "";
    } catch {
      attachedImageUrl = "";
    }
  }

  const result = await runAgentTurn({
    userId: user.id,
    projectId,
    tab: "image",
    systemPrompt: IMAGE_SYSTEM_PROMPT,
    tools: IMAGE_TOOLS,
    userText,
    attachedImageUrl: attachedImageUrl || undefined,
    attachedImageRole: imageRole,
    stateOverrides: imageModelOverride
      ? { image_model_override: imageModelOverride }
      : undefined,
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

export async function DELETE(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const projectId = u.searchParams.get("project_id") || null;
  await clearConversation(user.id, projectId, "image");
  return NextResponse.json({ ok: true });
}
