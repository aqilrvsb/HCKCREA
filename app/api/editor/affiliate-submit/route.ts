import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushToNlAffiliate, nlAffiliateConfigured, klToday } from "@/lib/nl-affiliate";
import { rehostToContent } from "@/lib/b2";

// POST /api/editor/affiliate-submit   { history_ids: string[] }
//
// STAGE 2 of the affiliate flow: PUSH the ticked "Ready Affiliate" videos to NL
// Affiliate Army (bulk, in parallel). On success each row is marked
// affiliate_submitted=true → it leaves the Ready Affiliate tab and shows in
// Reporting Affiliate. source_id makes the push idempotent, so a failed one can
// be re-submitted safely. Owner only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });
  if (!nlAffiliateConfigured()) {
    return NextResponse.json({ error: "NL ingest key tak diset pada server" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, output_url, caption, metadata")
    .in("id", ids)
    .eq("user_id", user.id)
    .filter("metadata->>affiliate_transferred", "eq", "true");

  const today = klToday();
  let pushed = 0;
  let failed = 0;
  const errors: { id: string; error: string }[] = [];

  // Push all in parallel — bulk.
  await Promise.all((rows || []).map(async (row: any) => {
    const m = { ...((row.metadata as Record<string, any>) || {}) };
    if (m.affiliate_submitted === true) { pushed++; return; } // already done

    // Cover check — dead provider covers 404 on the affiliate side, so rehost
    // an alive non-B2 cover, drop a dead one rather than ship a broken link.
    let coverUrl: string | null = m.cover_thumbnail_url ?? null;
    if (coverUrl && !coverUrl.includes("peninglab-content")) {
      let alive = false;
      try { alive = (await fetch(coverUrl, { method: "HEAD" })).ok; } catch { alive = false; }
      if (alive) {
        try {
          const hosted = await rehostToContent({ url: coverUrl, userId: user.id, historyId: `${row.id}-cover`, type: "image", fallbackExt: "png" });
          if (hosted?.includes("peninglab-content")) { coverUrl = hosted; m.cover_thumbnail_url = hosted; }
        } catch { /* keep original */ }
      } else {
        coverUrl = null;
        m.affiliate_cover_missing = true;
      }
    }

    const r = await pushToNlAffiliate({
      affiliateId: m.affiliate_id ?? null,
      staffId: m.affiliate_staff_id ?? null,
      outputUrl: String(row.output_url || ""),
      caption: row.caption ?? m.caption ?? null,
      coverTitle: m.cover_title ?? null,
      coverSubtitle: m.cover_subtitle ?? null,
      coverThumbnailUrl: coverUrl,
      date: m.affiliate_transfer_date || today,
      sourceId: `peninglab-history-${row.id}`,
    });
    m.affiliate_ingest_ok = r.ok;
    m.affiliate_ingest_at = new Date().toISOString();
    if (r.ok) {
      m.affiliate_submitted = true;
      m.affiliate_submitted_at = new Date().toISOString();
      m.affiliate_ingest_id = r.id ?? null;
      m.affiliate_ingest_duplicate = !!r.duplicate;
      delete m.affiliate_ingest_error;
      pushed++;
    } else {
      // stays in Ready Affiliate (affiliate_submitted false) for a re-submit
      m.affiliate_ingest_error = r.error || "gagal";
      m.affiliate_ingest_status = r.status ?? null;
      failed++;
      errors.push({ id: row.id, error: r.error || "gagal" });
    }
    await admin.from("history").update({ metadata: m }).eq("id", row.id).eq("user_id", user.id);
  }));

  return NextResponse.json({ ok: true, submitted: pushed, failed, errors });
}
