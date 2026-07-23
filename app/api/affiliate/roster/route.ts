import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchNlAffiliateRoster, nlAffiliateConfigured } from "@/lib/nl-affiliate";

// GET /api/affiliate/roster
// The affiliate roster straight from NL Affiliate Army: {id, name, staff_id,
// phone}. Settings uses it to import contacts, so the Staff IDs we transfer to
// are guaranteed to exist on their side, and it fills name + WhatsApp in one
// shot. (Email was retired 2026-07-23.)
// Session-authed; the ingest key never leaves the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!nlAffiliateConfigured()) {
    return NextResponse.json({ ok: false, error: "Ingest key tak diset pada server" }, { status: 503 });
  }
  const r = await fetchNlAffiliateRoster();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, affiliates: r.affiliates });
}
