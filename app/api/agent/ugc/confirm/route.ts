import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmAndFireUgc } from "@/lib/agent-ugc";

// POST /api/agent/ugc/confirm
// Called by the frontend after the user reviews + edits the variants in the
// confirmation dialog and clicks "Generate". Fires N Veo r2v jobs in parallel
// using whatever final params the user submitted.
//
// Body: {
//   project_id: string | null,
//   conversation_id: string,
//   product_image_url: string,
//   product_description: string,
//   duration: string,           // '8'
//   aspect_ratio: string,       // '9:16'
//   variants: [{ scene, persona, hook, structure, cta, voice, gender,
//                hijab?, age?, prompt, caption? }, ...]
// }
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
  const variants = Array.isArray(body?.variants) ? body.variants : [];
  if (variants.length === 0) {
    return NextResponse.json({ error: "No variants" }, { status: 400 });
  }

  const result = await confirmAndFireUgc({
    userId: user.id,
    projectId: body?.project_id || null,
    conversationId: String(body?.conversation_id || ""),
    product_image_url: String(body?.product_image_url || ""),
    product_description: String(body?.product_description || ""),
    duration: String(body?.duration || "8"),
    aspect_ratio: String(body?.aspect_ratio || "9:16"),
    variants,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Failed to fire UGC batch" },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    history_ids: result.history_ids,
    total_cost: result.total_cost,
  });
}
