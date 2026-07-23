import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupNlAffiliate, nlAffiliateConfigured } from "@/lib/nl-affiliate";

// GET /api/affiliate/lookup?staff_id=AFL-009
// Resolve ONE Staff ID → { id, name, staff_id, phone } from NL Affiliate Army,
// so Settings can let the user type only the Staff ID and auto-fill the name +
// WhatsApp (read-only). Session-authed; the ingest key never leaves the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!nlAffiliateConfigured()) {
    return NextResponse.json({ ok: false, error: "Ingest key tak diset pada server" }, { status: 503 });
  }
  const staffId = new URL(req.url).searchParams.get("staff_id") || "";
  if (!staffId.trim()) return NextResponse.json({ ok: false, error: "staff_id diperlukan" }, { status: 400 });

  const r = await lookupNlAffiliate(staffId);
  if (!r.ok) {
    // 404 from NL → surface as 404 so the client shows "ID tak dijumpai".
    const code = r.status === 404 ? 404 : 502;
    return NextResponse.json({ ok: false, error: r.error }, { status: code });
  }
  return NextResponse.json({ ok: true, affiliate: r.affiliate });
}
