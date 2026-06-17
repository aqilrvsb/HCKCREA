import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyExtToken } from "@/lib/livehost-ext-auth";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

const TYPES = new Set(["comment", "reply", "skip", "join", "greet", "follow", "like", "purchase", "feedback"]);

// POST: record viewer events for the dashboard. Two callers:
//  • EXTENSION (batched, ext token) → raw events join/follow/like/comment.
//  • STUDIO (the brain, cookie auth) → OUTCOMES it produces (greet/reply/skip)
//    + sim raw events. Without the studio path the GREETED/REPLIED/SKIPPED
//    counters stay 0 forever (nothing wrote them).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let userId = body.token ? await verifyExtToken(body.token) : null;
  if (!userId) {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    userId = user?.id || null;
  }
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  const rows = events
    .filter((e: any) => TYPES.has(String(e?.type)))
    .map((e: any) => ({
      user_id: userId,
      type: String(e.type),
      username: String(e.username || "").slice(0, 80),
      text: String(e.text || "").slice(0, 500),
    }));
  if (!rows.length) return NextResponse.json({ ok: true, inserted: 0 });
  const admin = createAdminClient();
  const { error } = await admin.from("live_interactions").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: rows.length });
}

// GET (client dashboard, cookie auth): counts + recent rows in a MYT date range.
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  const admin = createAdminClient();
  let q = admin
    .from("live_interactions")
    .select("type, username, text, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (start) q = q.gte("created_at", malaysiaDayToUtcRange(start, "start"));
  if (end) q = q.lte("created_at", malaysiaDayToUtcRange(end, "end"));
  const { data } = await q;
  const counts: Record<string, number> = {};
  for (const r of data || []) counts[r.type] = (counts[r.type] || 0) + 1;
  return NextResponse.json({ counts, recent: (data || []).slice(0, 100) });
}
