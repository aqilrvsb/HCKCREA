import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushToNlAffiliate, nlAffiliateConfigured, klToday } from "@/lib/nl-affiliate";

// POST /api/editor/transfer-affiliate
//   { history_ids: string[], email?, name?, undo?: boolean }
//
// Tag + record (like Done Post): assign the picked Editor videos to an affiliate
// (by email/name), which removes them from the Editor and lands them in the
// "Transfer Affiliate" tab. undo=true reverses it (untags + back to Editor).
// Nothing is copied to another account — purely the operator's own tracking.
// Owner only, session-authed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids)
    ? body.history_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
    : body?.history_id ? [String(body.history_id).trim()] : [];
  if (!ids.length) return NextResponse.json({ error: "history_ids required" }, { status: 400 });

  const undo = body?.undo === true;
  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  if (!undo && (!email || !email.includes("@"))) {
    return NextResponse.json({ error: "email affiliate diperlukan" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, output_url, caption, metadata")
    .in("id", ids)
    .eq("user_id", user.id);

  const today = klToday();
  let done = 0;
  let pushed = 0;
  let pushFailed = 0;
  const pushErrors: { id: string; error: string }[] = [];

  for (const row of rows || []) {
    const m = { ...((row.metadata as Record<string, any>) || {}) };
    if (undo) {
      // Back to the Editor. Ingest record is kept — their side already has the
      // post, and source_id keeps a re-transfer idempotent.
      delete m.affiliate_transferred;
      delete m.affiliate_email;
      delete m.affiliate_name;
      delete m.affiliate_transferred_at;
      m.in_editor = true;
    } else {
      m.affiliate_transferred = true;
      m.affiliate_email = email;
      m.affiliate_name = name || email.split("@")[0];
      m.affiliate_transferred_at = new Date().toISOString();
      m.affiliate_transfer_date = today; // KL date — what Reporting groups by
      m.in_editor = false; // leaves the Editor

      // Push to the affiliate's platform. source_id makes retries safe, so a
      // failure here never blocks the transfer — it's recorded and retryable.
      if (nlAffiliateConfigured()) {
        const r = await pushToNlAffiliate({
          email,
          outputUrl: String(row.output_url || ""),
          caption: row.caption ?? m.caption ?? null,
          coverTitle: m.cover_title ?? null,
          coverSubtitle: m.cover_subtitle ?? null,
          coverThumbnailUrl: m.cover_thumbnail_url ?? null,
          date: today,
          sourceId: `peninglab-history-${row.id}`,
        });
        m.affiliate_ingest_ok = r.ok;
        m.affiliate_ingest_at = new Date().toISOString();
        if (r.ok) {
          pushed++;
          m.affiliate_ingest_id = r.id ?? null;
          m.affiliate_ingest_duplicate = !!r.duplicate;
          delete m.affiliate_ingest_error;
        } else {
          pushFailed++;
          m.affiliate_ingest_error = r.error || "gagal";
          m.affiliate_ingest_status = r.status ?? null;
          pushErrors.push({ id: row.id, error: r.error || "gagal" });
        }
      } else {
        m.affiliate_ingest_ok = null; // push disabled — token not set
      }
    }
    const { error } = await admin.from("history").update({ metadata: m }).eq("id", row.id).eq("user_id", user.id);
    if (!error) done++;
  }

  return NextResponse.json({
    ok: true,
    [undo ? "undone" : "transferred"]: done,
    ...(undo ? {} : { pushed, push_failed: pushFailed, push_errors: pushErrors, push_enabled: nlAffiliateConfigured() }),
  });
}
