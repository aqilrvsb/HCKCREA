import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

// Admin Usage Chat feed — reads chat_usage rows for the date range and
// joins each row's user_id to its email via the auth admin API. Mirrors
// /api/admin/usage shape (rows[] payload) so the UI can reuse most of
// the table-rendering logic.
//
// Currently logs the model_custom_idea cascade only — three feature
// tags: ugc_custom_idea, auto_with_idea, auto_only.

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
  // Same Malaysia-local → UTC day boundary conversion the video usage
  // endpoint uses so the date pickers behave identically across both
  // admin pages.
  const fromIso = start ? malaysiaDayToUtcRange(start, "start") : null;
  const toIso = end ? malaysiaDayToUtcRange(end, "end") : null;

  // Chunked .range() fetch — Supabase caps every SELECT at 1000 rows
  // by default. Walk the rowset in 1000-row pages until the upstream
  // returns fewer than the page size.
  const PAGE = 1000;
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from("chat_usage")
      .select(
        "id, user_id, feature, model_key, cascade_trace, final_provider, final_model, succeeded, total_attempts, total_latency_ms, prompt_snippet, created_at"
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (fromIso) q = q.gte("created_at", fromIso);
    if (toIso) q = q.lte("created_at", toIso);
    const { data: page, error: pageErr } = await q;
    if (pageErr || !page || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Email lookup — listUsers paginates at 1000/page max; walk every
  // page until empty so installs > 1000 users still resolve emails on
  // every row.
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

  const out = rows.map((r: any) => ({
    ...r,
    email: r.user_id ? emailById.get(r.user_id) || "—" : "—",
  }));

  return NextResponse.json({ rows: out });
}
