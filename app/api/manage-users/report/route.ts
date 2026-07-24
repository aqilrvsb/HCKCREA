import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, manageUsersGroup } from "@/lib/manage-users";

// GET /api/manage-users/report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-user usage report for the team's managed users. Counts ONLY successful
// rows (status="done"), by the record/create date (history.created_at, KL).
//
// Categories:
//   totalStoryboard = feature "storyboard"
//   originalVideo   = tab "original-video" + feature "original-video" (raw only)
//   dialogUgc       = tab "video"
//   autoUgc         = tab "auto-ugc"
//   editor          = in_editor (currently in the Editor)
//   donePost        = posted_to_tiktok
//   donePostAff     = affiliate_transferred
//   totalVideo      = originalVideo + dialogUgc + autoUgc
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Counts = {
  totalStoryboard: number;
  totalVideo: number;
  originalVideo: number;
  dialogUgc: number;
  autoUgc: number;
  editor: number;
  donePost: number;
  donePostAff: number;
};
const zero = (): Counts => ({ totalStoryboard: 0, totalVideo: 0, originalVideo: 0, dialogUgc: 0, autoUgc: 0, editor: 0, donePost: 0, donePostAff: 0 });

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = manageUsersGroup(user.email);
  if (!group) return NextResponse.json({ ok: true, users: [] });

  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").trim(); // YYYY-MM-DD (KL)
  const to = (url.searchParams.get("to") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to perlu format YYYY-MM-DD" }, { status: 400 });
  }
  // KL day bounds as timestamptz (UTC+8).
  const startISO = `${from}T00:00:00+08:00`;
  const endISO = `${to}T23:59:59.999+08:00`;

  const admin = createAdminClient();

  // The team's managed users.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, settings")
    .filter("settings->>managed_group", "eq", group)
    .limit(1000);
  const managed = (profiles || []).map((p: any) => ({
    id: p.id as string,
    name: (p.full_name as string) || "",
    email: (p.settings?.managed_email as string) || "",
  }));
  if (!managed.length) return NextResponse.json({ ok: true, users: [], from, to });

  const ids = managed.map((m) => m.id);

  // One pass over the successful rows in range for all managed users.
  const per = new Map<string, Counts>();
  managed.forEach((m) => per.set(m.id, zero()));

  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: rows, error } = await admin
      .from("history")
      .select("user_id, tab, posted_to_tiktok, created_at, metadata")
      .in("user_id", ids)
      .eq("status", "done")
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = rows || [];
    for (const r of batch as any[]) {
      const c = per.get(r.user_id);
      if (!c) continue;
      const m = (r.metadata || {}) as Record<string, any>;
      const feature = String(m.feature || "");
      if (feature === "storyboard") c.totalStoryboard++;
      if (r.tab === "original-video" && feature === "original-video") { c.originalVideo++; c.totalVideo++; }
      else if (r.tab === "video") { c.dialogUgc++; c.totalVideo++; }
      else if (r.tab === "auto-ugc") { c.autoUgc++; c.totalVideo++; }
      if (m.in_editor === true) c.editor++;
      if (r.posted_to_tiktok === true) c.donePost++;
      if (m.affiliate_transferred === true) c.donePostAff++;
    }
    if (batch.length < PAGE) break;
  }

  const users = managed
    .map((m) => ({ ...m, counts: per.get(m.id) || zero() }))
    .sort((a, b) => (b.counts.totalStoryboard + b.counts.totalVideo) - (a.counts.totalStoryboard + a.counts.totalVideo));

  return NextResponse.json({ ok: true, from, to, users });
}
