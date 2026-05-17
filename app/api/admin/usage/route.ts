import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

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
  // Date inputs are Malaysia-local (UTC+8). Convert each wall-clock day
  // into the corresponding UTC boundary so a row at 17 May 07:19 MYT
  // (=16 May 23:19 UTC) is included when admin filters "May 17".
  if (start) q = q.gte("created_at", malaysiaDayToUtcRange(start, "start"));
  if (end) q = q.lte("created_at", malaysiaDayToUtcRange(end, "end"));

  const { data: txns } = await q;

  // Pull all linked history rows. Supabase silently caps a single
  // .in() query at the default 1000-row limit, so batch through the
  // ids in chunks and pass .limit(chunk.length) to defeat the cap.
  // Without this, a month-wide filter (>1000 unique history_ids)
  // would show "(history deleted)" for the rows whose history did
  // exist but fell off the truncated response.
  const historyIds = Array.from(
    new Set((txns || []).map((t: any) => t.history_id).filter(Boolean))
  );
  const histById = new Map<string, any>();
  const CHUNK = 500;
  for (let i = 0; i < historyIds.length; i += CHUNK) {
    const chunk = historyIds.slice(i, i + CHUNK);
    const { data: hists } = await admin
      .from("history")
      .select("id, type, tab, prompt, output_url, thumbnail_url, reference_url, duration, metadata")
      .in("id", chunk)
      .limit(chunk.length);
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
