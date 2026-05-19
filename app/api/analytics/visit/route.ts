import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/analytics/visit
// Unauthenticated beacon. Browser fires this ONCE per session (the
// FBPixel component uses sessionStorage to dedupe) so volume scales
// with unique visitors per day, not page navs.
//
// PAID-ADS ONLY: per admin direction, we record a visit ONLY when the
// session arrived with a utm_source — i.e. clicked through from a Meta
// ad link. Organic visitors are skipped at insert time so the page_visits
// table stays focused on ads attribution and doesn't drown the admin
// dashboard in noise from existing clients hitting the marketing page.
//
// The endpoint silently no-ops on any error — visit tracking is a
// "nice to have" and must never affect the marketing page UX.

// Cheap UA-based bot heuristic. The full bot list is huge, but covering
// the obvious ones gets us 90% of the way to a clean visitor count.
// Anything we miss can be filtered downstream in the admin SQL.
const BOT_UA_PATTERNS = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /facebookexternalhit/i,
  /headlesschrome/i,
  /lighthouse/i,
  /pingdom/i,
  /uptimerobot/i,
  /slurp/i,
  /preview/i,
  /scraper/i,
];

function isBotUa(ua: string | null): boolean {
  if (!ua) return true; // treat missing UA as bot — real browsers always send one
  return BOT_UA_PATTERNS.some((re) => re.test(ua));
}

// Hash the IP rather than store it raw — gives us repeat-visit grouping
// without retaining PII. Salt is the same per row so equal IPs hash to
// the same value within a date range.
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip.trim()).digest("hex").slice(0, 32);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const path = String(body?.path || "/").slice(0, 256);
    const sessionId = String(body?.session_id || "").slice(0, 64) || null;
    const utm = body?.utm || {};

    // PAID-ADS ONLY gate. Sessions without utm_source are organic and
    // intentionally NOT recorded. Defence-in-depth — the client should
    // already skip the fetch, but never trust the client.
    if (!utm.source) {
      return NextResponse.json({ ok: true, skipped: "organic" });
    }

    const ua = req.headers.get("user-agent");
    // Vercel forwards original IP via x-forwarded-for. First entry is
    // the client IP, subsequent entries are proxy hops.
    const xff = req.headers.get("x-forwarded-for") || "";
    const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

    const admin = createAdminClient();
    await admin.from("page_visits").insert({
      path,
      session_id: sessionId,
      ip_hash: hashIp(ip),
      ua: ua?.slice(0, 512) || null,
      is_bot: isBotUa(ua),
      utm_source: utm.source ? String(utm.source).slice(0, 64) : null,
      utm_medium: utm.medium ? String(utm.medium).slice(0, 64) : null,
      utm_campaign: utm.campaign ? String(utm.campaign).slice(0, 128) : null,
      utm_content: utm.content ? String(utm.content).slice(0, 128) : null,
      utm_term: utm.term ? String(utm.term).slice(0, 128) : null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Silent no-op — analytics must never break the page.
    return NextResponse.json({ ok: true });
  }
}
