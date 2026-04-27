import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmAndFireCinema } from "@/lib/agent-cinema";

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
  const result = await confirmAndFireCinema({
    userId: user.id,
    projectId: body?.project_id || null,
    conversationId: String(body?.conversation_id || ""),
    prompt: String(body?.prompt || ""),
    image_url: String(body?.image_url || ""),
    image_mode: body?.image_mode === "image" ? "image" : "text",
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
