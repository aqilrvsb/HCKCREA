import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmAndFireCinema } from "@/lib/agent-cinema";
import { loadConversation } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = body?.project_id || null;
  const rawPrompt = String(body?.prompt || "");
  const imageMode = body?.image_mode === "image" ? "image" : "text";

  // Pull the USP the user typed in the product-reference modal so we can
  // hard-pin it to the front of the Grok prompt. Only meaningful when the
  // image_mode is "image" (i2v with a product reference); for pure t2v
  // there's no product to lock to.
  let finalPrompt = rawPrompt;
  if (imageMode === "image") {
    const conv = await loadConversation(user.id, projectId, "cinema");
    const productUsp = String(conv?.state?.last_product_usp || "").trim();
    if (productUsp) {
      finalPrompt = `PRODUCT INFO (user-provided — respect verbatim, anchor scene around these facts):\n${productUsp}\n\n${rawPrompt}`;
    }
  }

  const result = await confirmAndFireCinema({
    userId: user.id,
    projectId,
    conversationId: String(body?.conversation_id || ""),
    prompt: finalPrompt,
    image_url: String(body?.image_url || ""),
    image_mode: imageMode,
    aspect_ratio: String(body?.aspect_ratio || "9:16"),
    duration: Number(body?.duration || 8),
    mood_skill_id: body?.mood_skill_id,
    director_skill_id: body?.director_skill_id,
    camera_skill_id: body?.camera_skill_id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Failed to fire Cinema clip" },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    history_id: result.history_id,
    cost: result.cost,
  });
}
