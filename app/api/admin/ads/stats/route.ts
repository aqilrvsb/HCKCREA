import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/ads/stats?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// PAID-ADS ONLY dashboard:
//   - visitors:        DISTINCT session_id from page_visits (already
//                      restricted to ads-tagged sessions at insert time)
//   - page_views:      COUNT(*) from page_visits
//   - bot_visitors:    DISTINCT session_id where is_bot=true (info only)
//   - checkouts:       COUNT(*) from payments where type='checkout_signup'
//                      AND metadata->utm->source IS NOT NULL (ads-attributed)
//   - purchases:       same filter PLUS status='paid'
//   - revenue_myr:     SUM(amount) for those paid rows
//   - cvr_v2c:         visitors → checkouts conversion rate
//   - cvr_c2p:         checkouts → purchases conversion rate
//   - cvr_v2p:         end-to-end visitor → purchase conversion rate
//
// Both data sources (page_visits + payments) are filtered to ads-only
// upstream — page_visits doesn't insert organic rows at all, and the
// payments query filters by metadata->utm. So the conversion rates
// here are pure ads ROI, not contaminated by organic signups.
//
// Date filtering uses Malaysia time (UTC+8). The Malaysia-local
// yyyy-mm-dd strings get translated to UTC boundaries by
// malaysiaDayToUtcRange so a row at "17 May 07:19 MYT" is correctly
// included when admin filters "May 17".
export async function GET(req: Request) {
  // Admin gate: only profiles.is_admin=true can hit this endpoint.
  // Mirrors the gate used by app/admin/layout.tsx so anyone who can
  // reach the page can also call the API.
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { data: prof } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
  }

  const startUtc = malaysiaDayToUtcRange(start, "start");
  const endUtc = malaysiaDayToUtcRange(end, "end");

  const admin = createAdminClient();

  // ──────────── Visits ────────────
  // page_visits already only contains ads-tagged sessions (insert-time
  // gate in /api/analytics/visit), so no further filter needed here.
  // Aggregation done in app code because Supabase JS doesn't expose
  // DISTINCT without RPC, and row count is bounded by ~1 row per unique
  // session per day — small.
  const { data: visits, error: visitsErr } = await admin
    .from("page_visits")
    .select("session_id, is_bot, utm_source", { count: "exact" })
    .gte("created_at", startUtc)
    .lte("created_at", endUtc)
    .limit(50000); // safety cap
  if (visitsErr) {
    return NextResponse.json({ error: visitsErr.message }, { status: 500 });
  }

  const humanSessions = new Set<string>();
  const botSessions = new Set<string>();
  let pageViews = 0;
  let botPageViews = 0;
  for (const v of visits || []) {
    pageViews++;
    const sid = v.session_id || "anon";
    if (v.is_bot) {
      botSessions.add(sid);
      botPageViews++;
    } else {
      humanSessions.add(sid);
    }
  }

  // ──────────── Checkouts + Purchases (ADS-ATTRIBUTED ONLY) ────────────
  // Every "Bayar RM75" click creates a payments row with
  // type='checkout_signup'. The checkout-form reads the peninglab_utm
  // cookie set by FBPixel on ads landing and posts utm into /api/checkout
  // which stamps it onto metadata.utm. We filter on metadata.utm.source
  // here so organic signups (no cookie → no metadata.utm) are excluded.
  //
  // metadata is jsonb — Supabase's .filter() with the "->>"" syntax
  // produces the right SQL: metadata->'utm'->>'source' IS NOT NULL.
  const { data: payments, error: payErr } = await admin
    .from("payments")
    .select("id, status, amount, metadata")
    .eq("type", "checkout_signup")
    .gte("created_at", startUtc)
    .lte("created_at", endUtc)
    .not("metadata->utm->>source", "is", null)
    .limit(50000);
  if (payErr) {
    return NextResponse.json({ error: payErr.message }, { status: 500 });
  }

  const checkouts = (payments || []).length;
  const paidRows = (payments || []).filter((p: any) => p.status === "paid");
  const purchases = paidRows.length;
  const revenue = paidRows.reduce(
    (acc: number, p: any) => acc + Number(p.amount || 0),
    0
  );

  // Conversion rates — null when denominator is 0 so the UI can render
  // "—" instead of NaN%. Round to one decimal for display sanity.
  const pct = (num: number, den: number): number | null =>
    den > 0 ? Number(((num / den) * 100).toFixed(1)) : null;

  const visitors = humanSessions.size;

  return NextResponse.json({
    ok: true,
    range: { start, end },
    visitors,
    page_views: pageViews,
    bot_visitors: botSessions.size,
    bot_page_views: botPageViews,
    checkouts,
    purchases,
    revenue_myr: Number(revenue.toFixed(2)),
    cvr_v2c: pct(checkouts, visitors),
    cvr_c2p: pct(purchases, checkouts),
    cvr_v2p: pct(purchases, visitors),
  });
}
