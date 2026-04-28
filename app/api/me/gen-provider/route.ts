import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGenProvider } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/gen-provider — exposes the currently active gen backend
// for each asset class (image / video / cinema). Used by the agent
// chat panel to hide provider-specific UI options (e.g. GPT Image 2 is
// Crun-only, so we hide it when image is on GeminiGen).
//
// Auth required so unauth'd clients can't probe admin config.
export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [image, video, cinema] = await Promise.all([
    getGenProvider("image"),
    getGenProvider("video"),
    getGenProvider("cinema"),
  ]);

  return NextResponse.json({
    ok: true,
    image,
    video,
    cinema,
  });
}
