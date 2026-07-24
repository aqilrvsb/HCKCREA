import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { klToday } from "@/lib/nl-affiliate";

// POST /api/editor/transfer-affiliate
//   { history_ids: string[], staff_id?, affiliate_id?, name?, phone?, undo? }
//
// STAGE 1 of the affiliate flow: ASSIGN an affiliate to the picked Editor videos
// and mark them READY. This does NOT push to NL — the videos leave the Editor
// and wait in the "Ready Affiliate" tab, where the user ticks + Submit to
// actually post (STAGE 2 = /api/editor/affiliate-submit). undo=true reverses it
// (untags + back to Editor). Identity is Staff ID (AFL-###). Owner only.
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
  // Editor just marks videos READY — the affiliate is chosen later in the Ready
  // Affiliate tab at Submit time. So no affiliate is required here.

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, output_url, caption, metadata")
    .in("id", ids)
    .eq("user_id", user.id);

  const today = klToday();
  let done = 0;
  const notReady: string[] = [];

  for (const row of rows || []) {
    const m = { ...((row.metadata as Record<string, any>) || {}) };

    // Text + Cover must be done before a video reaches an affiliate. Frame is
    // OPTIONAL (per user direction 2026-07-22) — an unframed video is still a
    // complete post. Already-transferred rows are exempt so Reporting's
    // "Hantar semula" can still retry a failed push.
    if (!undo && !m.affiliate_transferred) {
      const hasText = !!(row.caption || m.caption || m.cover_title);
      const ready = hasText && !!m.cover_thumbnail_url;
      if (!ready) { notReady.push(row.id); continue; }
    }

    if (undo) {
      // Back to the Editor. Ingest record is kept — their side already has the
      // post, and source_id keeps a re-transfer idempotent.
      delete m.affiliate_transferred;
      delete m.affiliate_submitted;
      delete m.affiliate_staff_id;
      delete m.affiliate_id;
      delete m.affiliate_phone;
      delete m.affiliate_name;
      delete m.affiliate_transferred_at;
      m.in_editor = true;
    } else {
      // MARK READY only — NO affiliate is chosen here. The video leaves the
      // Editor and waits in the "Ready Affiliate" tab, where the user picks an
      // affiliate from the dropdown, ticks + Submit to assign + push to NL
      // (see /api/editor/affiliate-submit).
      m.affiliate_transferred = true;
      m.affiliate_submitted = false; // not pushed to NL yet, no affiliate yet
      m.affiliate_transferred_at = new Date().toISOString();
      m.affiliate_transfer_date = today; // KL date — what Reporting groups by
      m.in_editor = false; // leaves the Editor
    }
    const { error } = await admin.from("history").update({ metadata: m }).eq("id", row.id).eq("user_id", user.id);
    if (!error) done++;
  }

  return NextResponse.json({
    ok: true,
    [undo ? "undone" : "transferred"]: done,
    ...(undo ? {} : { not_ready: notReady }),
  });
}
