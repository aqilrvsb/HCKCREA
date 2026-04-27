import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgentTurn, loadConversation, clearConversation } from "@/lib/agent";
import { CINEMA_SYSTEM_PROMPT, CINEMA_TOOLS } from "@/lib/agent-cinema";

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
  const conv = await loadConversation(user.id, projectId, "cinema");
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
  // "product" → skip vision, pass straight to Grok as i2v reference.
  const imageRole: "general" | "product" =
    body?.image_role === "product" ? "product" : "general";
  // Plain-text USP / description that came in alongside a product image.
  // Folded into the user turn so the LLM can anchor the prompt on it.
  const productUsp = String(body?.product_usp || "").trim();

  if (!userText && !attachedImageUrl) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const finalUserText =
    imageRole === "product" && productUsp
      ? `[Product reference attached. USP / description:\n${productUsp}\n]\n\n${userText}`
      : userText;

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
    tab: "cinema",
    systemPrompt: CINEMA_SYSTEM_PROMPT,
    tools: CINEMA_TOOLS,
    userText: finalUserText,
    attachedImageUrl: attachedImageUrl || undefined,
    attachedImageRole: imageRole,
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
  await clearConversation(user.id, projectId, "cinema");
  return NextResponse.json({ ok: true });
}
