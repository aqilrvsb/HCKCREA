import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/activity-feed?limit=30
//
// Returns the most-recent successful generations across ALL users, with
// email + display tab attached. Powers the floating ActivityFeed panel
// admin sees on the dashboard so they can monitor what clients are
// producing in near-real-time. Admin-only.
//
// We DON'T include pending or failed rows — admin's monitoring purpose
// is "what are clients actually shipping". Failed rows clutter the feed.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedRow = {
  id: string;
  user_id: string;
  email: string;
  tab: string;
  type: string;
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: meAdmin } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!meAdmin?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.max(5, Math.min(60, Number(url.searchParams.get("limit")) || 30));

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("history")
    .select("id, user_id, type, tab, output_url, thumbnail_url, created_at")
    .eq("status", "done")
    .not("output_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve emails — listUsers is the only admin-API surface for it.
  // Cap at perPage 200 so we don't blow the limit; the query itself
  // already capped at 60 rows.
  const userIds = Array.from(new Set((rows || []).map((r) => r.user_id)));
  const emailById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of list?.users || []) {
      if (userIds.includes(u.id)) emailById.set(u.id, u.email || "(unknown)");
    }
  }

  const items: FeedRow[] = (rows || []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    email: emailById.get(r.user_id) || "(unknown)",
    tab: r.tab || r.type || "—",
    type: r.type,
    output_url: r.output_url,
    thumbnail_url: r.thumbnail_url,
    created_at: r.created_at,
  }));

  return NextResponse.json({ ok: true, items });
}
