import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/editor/list — the user's finished videos flagged in_editor, newest
// first. Feeds the /editor page. caption is a column; cover_* / product_* live
// in metadata.
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional project scope (?p=<projectId>) — the in-page Editor tab passes the
  // current project so it only shows that project's transferred videos.
  const projectId = new URL(req.url).searchParams.get("p");

  const admin = createAdminClient();
  let q = admin
    .from("history")
    .select("id, type, tab, status, output_url, thumbnail_url, reference_url, duration, caption, metadata, created_at")
    .eq("user_id", user.id)
    .eq("type", "video")
    .filter("metadata->>in_editor", "eq", "true");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q.order("created_at", { ascending: false }).limit(500);

  const rows = (data || []).map((r: any) => {
    const m = (r.metadata || {}) as Record<string, any>;
    return {
      id: r.id,
      status: r.status,
      output_url: r.output_url || null,
      thumbnail_url: r.thumbnail_url || m.poster_url || null,
      duration: r.duration || null,
      caption: r.caption || m.caption || "",
      cover_title: m.cover_title || "",
      cover_subtitle: m.cover_subtitle || "",
      cover_thumbnail_url: m.cover_thumbnail_url || "",
      product_name: m.product_name || "",
      tiktok_product_id: m.tiktok_product_id || "",
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ rows });
}
