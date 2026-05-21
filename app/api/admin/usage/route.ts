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
  // Date inputs are Malaysia-local (UTC+8). Convert each wall-clock day
  // into the corresponding UTC boundary so a row at 17 May 07:19 MYT
  // (=16 May 23:19 UTC) is included when admin filters "May 17".
  const fromIso = start ? malaysiaDayToUtcRange(start, "start") : null;
  const toIso = end ? malaysiaDayToUtcRange(end, "end") : null;

  // Chunked fetch — Supabase silently caps every SELECT at 1000 rows by
  // default. Old code passed .limit(2000), but month-wide ranges
  // routinely cross that threshold (worst case: an active client doing
  // 100 generations/day × 30 days = 3000+ deduction rows), so the table
  // was truncating the oldest entries. Walk the rowset via .range() in
  // 1000-row chunks until the upstream returns fewer than the page
  // size — that's the natural "we've drained the result set" signal.
  const PAGE = 1000;
  const txns: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from("credit_transactions")
      .select("id, user_id, amount, reason, created_at, history_id")
      .lt("amount", 0)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (fromIso) q = q.gte("created_at", fromIso);
    if (toIso) q = q.lte("created_at", toIso);
    const { data: page, error: pageErr } = await q;
    if (pageErr || !page || page.length === 0) break;
    txns.push(...page);
    if (page.length < PAGE) break;
  }

  // Pull all linked history rows. Same 1000-row Supabase cap applies
  // to .in() queries — batch through the ids in chunks and pass
  // .limit(chunk.length) to defeat it.
  const historyIds = Array.from(
    new Set(txns.map((t: any) => t.history_id).filter(Boolean))
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

  // Email lookup — listUsers paginates at 1000/page max, so walk every
  // page until empty. Previously hardcoded perPage: 500 with no second
  // page, which meant any installation past 500 users showed "—" for
  // the email column on the older accounts' rows.
  const emailById = new Map<string, string>();
  for (let pageNum = 1; ; pageNum++) {
    const { data: authList } = await admin.auth.admin.listUsers({
      page: pageNum,
      perPage: 1000,
    });
    const users = authList?.users || [];
    users.forEach((u: any) => emailById.set(u.id, u.email || ""));
    if (users.length < 1000) break;
  }

  const rows = txns.map((t: any) => {
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
