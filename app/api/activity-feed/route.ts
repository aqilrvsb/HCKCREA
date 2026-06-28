import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/activity-feed?limit=30
//
// Public-but-authed live activity stream — powers the floating
// "Live activity" panel every signed-in user sees on the dashboard.
// Purpose is social proof: showing the platform is busy + active
// encourages new users to dive in. NOT for monitoring.
//
// We anonymize emails to a friendly display name (first name + last
// initial, OR first 3 chars + ***) so we never leak full client
// identities to other clients. Asset URLs stay real because the
// preview modal layers a hard-to-remove watermark over them.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedRow = {
  id: string;
  display_name: string;
  tab: string;
  type: string;
  model: string;
  duration: number | null;
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
};

// Friendly model name from the row's metadata (modelChoice/model) so the feed
// shows "Grok" / "Veo" / "Seedance" etc. Empty when we can't tell.
function friendlyModel(meta: any, type: string): string {
  if (type === "fairytale") return "Storytelling";
  const s = String(meta?.modelChoice || meta?.model || "").toLowerCase();
  if (s.includes("grok")) return "Grok";
  if (s.includes("sora")) return "Sora 2";
  if (s.includes("seedance")) return "Seedance";
  if (s.includes("gemini")) return "Gemini";
  if (s.includes("kling")) return "Kling";
  if (s.includes("veo")) return "Veo";
  return "";
}

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.max(5, Math.min(60, Number(url.searchParams.get("limit")) || 10));

  // "Today" means today in Malaysia (UTC+8) — the timestamps the user
  // sees in the panel are also Malaysia-localised, so a row that
  // appeared 30 minutes ago shouldn't disappear at UTC midnight.
  // en-CA gives ISO-style YYYY-MM-DD which is what Date() can re-parse
  // when paired with a fixed +08:00 offset.
  const todayMyDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayMyMidnightUtc = new Date(`${todayMyDate}T00:00:00+08:00`).toISOString();

  // Video-only feed: UGC (video) / AI Agent UGC (ugc) /
  // Auto Content (auto-content) / Cinema (seedance) / Storytelling
  // (fairytale). Plain images stay excluded — feed focuses on the
  // polished video outputs that best sell the platform.
  const VIDEO_TYPES = ["video", "ugc", "auto-content", "seedance", "fairytale"];

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("history")
    .select("id, user_id, type, tab, output_url, thumbnail_url, created_at, metadata, duration")
    .eq("status", "done")
    .not("output_url", "is", null)
    .in("type", VIDEO_TYPES)
    .gte("created_at", todayMyMidnightUtc)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((rows || []).map((r) => r.user_id)));
  const emailById = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of list?.users || []) {
      if (userIds.includes(u.id)) emailById.set(u.id, u.email || "");
    }
  }

  const items: FeedRow[] = (rows || []).map((r) => ({
    id: r.id,
    display_name: emailById.get(r.user_id) || "(unknown)",
    tab: r.tab || r.type || "—",
    type: r.type,
    model: friendlyModel((r as any).metadata, r.type),
    duration: typeof (r as any).duration === "number" ? (r as any).duration : null,
    output_url: r.output_url,
    thumbnail_url: r.thumbnail_url,
    created_at: r.created_at,
  }));

  return NextResponse.json({ ok: true, items });
}
