import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, user_id, metadata")
    .in("id", ids)
    .eq("user_id", user.id);

  let done = 0;
  for (const row of rows || []) {
    const m = { ...((row.metadata as Record<string, any>) || {}) };
    if (undo) {
      // Back to the Editor.
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
      m.in_editor = false; // leaves the Editor
    }
    const { error } = await admin.from("history").update({ metadata: m }).eq("id", row.id).eq("user_id", user.id);
    if (!error) done++;
  }

  return NextResponse.json({ ok: true, [undo ? "undone" : "transferred"]: done });
}
