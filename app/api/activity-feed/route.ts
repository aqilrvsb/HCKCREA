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
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
};

// Turn an email + optional full_name into something safe to show to
// strangers. Order of preference:
//   1. "Ahmad R." (first word of full_name + initial of second word)
//   2. "Ahmad"    (single-word full_name)
//   3. "ahm***"   (first 3 chars of local-part of email)
//   4. "Someone"  (fallback)
function anonymize(email: string | null | undefined, fullName: string | null | undefined): string {
  const name = String(fullName || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
    return parts[0];
  }
  const local = String(email || "").split("@")[0];
  if (local && local.length >= 3) return `${local.slice(0, 3).toLowerCase()}***`;
  if (local) return `${local.toLowerCase()}***`;
  return "Someone";
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

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("history")
    .select("id, user_id, type, tab, output_url, thumbnail_url, created_at")
    .eq("status", "done")
    .not("output_url", "is", null)
    // Skip noisy intermediate scene rows — only the merged storytelling
    // shows up in the feed, not its 10 individual scene images.
    .neq("type", "fairytale-scene")
    .gte("created_at", todayMyMidnightUtc)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((rows || []).map((r) => r.user_id)));
  const nameById = new Map<string, string | null>();
  const emailById = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of profiles || []) {
      nameById.set(p.id, p.full_name);
    }
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of list?.users || []) {
      if (userIds.includes(u.id)) emailById.set(u.id, u.email || "");
    }
  }

  const items: FeedRow[] = (rows || []).map((r) => ({
    id: r.id,
    display_name: anonymize(emailById.get(r.user_id), nameById.get(r.user_id) || null),
    tab: r.tab || r.type || "—",
    type: r.type,
    output_url: r.output_url,
    thumbnail_url: r.thumbnail_url,
    created_at: r.created_at,
  }));

  return NextResponse.json({ ok: true, items });
}
