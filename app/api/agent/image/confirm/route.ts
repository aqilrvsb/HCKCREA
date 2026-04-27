import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmAndFireImage } from "@/lib/agent-image";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const refUrls: string[] = Array.isArray(body?.reference_urls)
    ? body.reference_urls.filter(Boolean).map(String)
    : [];

  const result = await confirmAndFireImage({
    userId: user.id,
    projectId: body?.project_id || null,
    conversationId: String(body?.conversation_id || ""),
    prompt: String(body?.prompt || ""),
    model: body?.model === "gpt-image-2" ? "gpt-image-2" : "nano-banana-pro",
    reference_urls: refUrls,
    aspect_ratio: String(body?.aspect_ratio || "1:1"),
    count: Number(body?.count || 1),
    photographer_skill_id: body?.photographer_skill_id,
    brand_skill_id: body?.brand_skill_id,
    composite_skill_id: body?.composite_skill_id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Failed to fire Image batch" },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    history_ids: result.history_ids,
    total_cost: result.total_cost,
  });
}
