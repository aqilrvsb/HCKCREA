import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/livehost/body-clips — list the user's finished Template Body motion
// clips (Kling v3 motion-control, generated on a green/blue chroma screen) so
// the Livehost studio can pick one as a draggable, chroma-keyed BODY layer
// composited under the AVTR-1 talking head. Read-only, user-scoped (RLS).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("history")
    .select("id, output_url, reference_url, metadata, created_at")
    .eq("user_id", user.id)
    .eq("tab", "template-body")
    .eq("status", "done")
    .not("output_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clips = (data || []).map((r: any) => ({
    id: r.id,
    url: r.output_url as string,
    // the chroma bg used at generation, so the studio keys the right colour
    // (falls back to auto-detect from a corner pixel when absent)
    bgColor: (r.metadata?.bgColor || r.metadata?.bg_color || "") as string,
    poster: (r.reference_url || "") as string,
    createdAt: r.created_at as string,
  }));

  return NextResponse.json({ clips });
}
