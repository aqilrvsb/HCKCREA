import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin Usage feed — credit_transactions joined to the originating history
// row so the Detail Log can show prompt + output preview without a second
// fetch per row. Deductions only (positive amounts = top-ups, hidden from
// usage stats).
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!meAdmin?.is_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const admin = createAdminClient();
  let q = admin
    .from("credit_transactions")
    .select("id, user_id, amount, reason, created_at, history_id")
    .lt("amount", 0)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (start) q = q.gte("created_at", start + "T00:00:00");
  if (end) q = q.lte("created_at", end + "T23:59:59");

  const { data: txns } = await q;

  // Pull all linked history rows in one shot
  const historyIds = Array.from(
    new Set((txns || []).map((t: any) => t.history_id).filter(Boolean))
  );
  const histById = new Map<string, any>();
  if (historyIds.length > 0) {
    const { data: hists } = await admin
      .from("history")
      .select("id, type, tab, prompt, output_url, thumbnail_url, reference_url, duration, metadata")
      .in("id", historyIds);
    (hists || []).forEach((h: any) => histById.set(h.id, h));
  }

  // Email lookup
  const ids = Array.from(new Set((txns || []).map((t: any) => t.user_id)));
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const emailById = new Map<string, string>();
  (authList?.users || []).forEach((u: any) => emailById.set(u.id, u.email || ""));

  const rows = (txns || []).map((t: any) => {
    const h = t.history_id ? histById.get(t.history_id) : null;
    return {
      id: t.id,
      user_id: t.user_id,
      email: emailById.get(t.user_id) || "—",
      reason: t.reason,
      amount: t.amount,
      created_at: t.created_at,
      history_id: t.history_id,
      type: h?.type || null,
      tab: h?.tab || null,
      prompt: h?.prompt || null,
      output_url: h?.output_url || null,
      thumbnail_url: h?.thumbnail_url || null,
      duration: h?.duration ?? null,
      metadata: h?.metadata || null,
    };
  });

  return NextResponse.json({ rows });
}
