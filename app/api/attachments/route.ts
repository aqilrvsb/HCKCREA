import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/attachments?page=N&pageSize=25
// Returns the signed-in user's attachments newest-first, paginated.
// RLS handles per-user scoping — no manual user_id filter needed.

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await sb
    .from("attachments")
    .select("id, name, public_url, content_type, size_bytes, width, height, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    attachments: data || [],
    page,
    pageSize,
    total: count || 0,
    hasMore: (count || 0) > to + 1,
  });
}
