import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgentTurn, loadConversation, clearConversation } from "@/lib/agent";
import { loadLivechatSystemPrompt, LIVECHAT_TOOLS } from "@/lib/agent-livechat";

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
  // "product" → skip vision, pass straight through as the product reference.
  const imageRole: "general" | "product" =
    body?.image_role === "product" ? "product" : "general";
  // Plain-text USP / description that came in alongside a product image.
  const productUsp = String(body?.product_usp || "").trim();

  // Load Data product picker — the frontend sends the chosen saved product
  // (Beg Kuning affiliate / Tiada Link manual): name, detail, and image URLs.
  // We fold a context block into the user turn AND stash the image URLs on
  // conversation state so generate_image locks the exact product.
  const product = body?.product || null;
  const productName = String(product?.name || "").trim();
  const productDetail = String(product?.detail || "").trim();
  const productImageUrls: string[] = (Array.isArray(product?.image_urls) ? product.image_urls : [])
    .filter((u: any) => typeof u === "string" && u.trim())
    .slice(0, 3);

  if (!userText && !attachedImageUrl && !productName && productImageUrls.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  let finalUserText = userText;
  if (productName || productDetail || productImageUrls.length > 0) {
    finalUserText =
      `[PRODUK DIPILIH dari Load Data]\n` +
      (productName ? `Nama: ${productName}\n` : "") +
      (productDetail ? `Detail: ${productDetail}\n` : "") +
      (productImageUrls.length > 0 ? `Gambar produk: ${productImageUrls.length} imej dilampirkan.\n` : "") +
      `\n${userText}`.trimEnd();
  } else if (imageRole === "product" && productUsp) {
    finalUserText = `[Product reference attached. USP / description:\n${productUsp}\n]\n\n${userText}`;
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

  const systemPrompt = await loadLivechatSystemPrompt();
  const result = await runAgentTurn({
    userId: user.id,
    projectId,
    tab: "cinema",
    systemPrompt,
    tools: LIVECHAT_TOOLS,
    // Livechat runs on the Q&A routing (grsai gemini-3.5-flash → openrouter
    // fallback) per user direction — resolved via parseModelSetting so the
    // grsai provider works for the tool-use loop.
    modelSettingKey: "model_qa",
    userText: finalUserText || "(produk dipilih)",
    attachedImageUrl: attachedImageUrl || undefined,
    attachedImageRole: imageRole,
    attachedProductUsp: imageRole === "product" ? productUsp : undefined,
    // Persist the picked product's images so generate_image can lock the
    // exact product across turns without the LLM re-passing every URL.
    stateOverrides:
      productImageUrls.length > 0 ? { product_image_urls: productImageUrls } : undefined,
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
