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
  let q = admin
    .from("chat_usage")
    .select(
      "id, user_id, feature, model_key, cascade_trace, final_provider, final_model, succeeded, total_attempts, total_latency_ms, prompt_snippet, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  // Same Malaysia-local → UTC day boundary conversion the video usage
  // endpoint uses so the date pickers behave identically across both
  // admin pages.
  if (start) q = q.gte("created_at", malaysiaDayToUtcRange(start, "start"));
  if (end) q = q.lte("created_at", malaysiaDayToUtcRange(end, "end"));

  const { data: rows } = await q;

  // Email lookup — same pattern as /api/admin/usage. 500-user page is
  // fine for the admin client.
  const ids = Array.from(
    new Set((rows || []).map((r: any) => r.user_id).filter(Boolean))
  );
  const { data: authList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  const emailById = new Map<string, string>();
  (authList?.users || []).forEach((u: any) =>
    emailById.set(u.id, u.email || "")
  );

  const out = (rows || []).map((r: any) => ({
    ...r,
    email: r.user_id ? emailById.get(r.user_id) || "—" : "—",
  }));

  return NextResponse.json({ rows: out });
}
