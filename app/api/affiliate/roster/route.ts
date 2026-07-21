import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchNlAffiliateRoster, nlAffiliateConfigured } from "@/lib/nl-affiliate";

// GET /api/affiliate/roster
// The affiliate roster straight from NL Affiliate Army. Settings uses it to
// import contacts, so the emails we transfer to are guaranteed to exist on
// their side — a typo'd email would otherwise fail the ingest with a 404 only
// after the transfer had already happened.
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
