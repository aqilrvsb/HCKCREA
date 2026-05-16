import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin Errors feed — surfaces history rows that ENDED in failed state
// (i.e. all cascade tiers + fallback + auto-resubmit retries gave up).
// Rows that eventually succeeded via fallback/retry are excluded since
// status flips back to 'pending' → 'succeeded' on a successful retry.
//
// Returns: counts split video vs image + a flat row list with email,
// tab, provider, model, error text, created_at.
//
// Query: ?start=YYYY-MM-DD&end=YYYY-MM-DD  (Malaysia-local; we add the
// UTC+8 offset before sending to Postgres).
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
  const start = url.searchParams.get("start"); // YYYY-MM-DD (MY local)
  const end = url.searchParams.get("end");

  // Malaysia is UTC+8 — convert the date-only filters to the exact UTC
  // boundary so a row created at 00:30 KL time on the start date is
  // included (00:30 KL = 16:30 UTC of the previous day).
  function localDayToUtcRange(day: string, side: "start" | "end"): string {
    const t = side === "start" ? "00:00:00" : "23:59:59.999";
    const local = new Date(`${day}T${t}+08:00`);
    return local.toISOString();
  }

  const admin = createAdminClient();
  let q = admin
    .from("history")
    .select(
      "id, user_id, type, tab, status, error_message, metadata, created_at, prompt"
    )
    .eq("status", "failed")
    .not("error_message", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (start) q = q.gte("created_at", localDayToUtcRange(start, "start"));
  if (end) q = q.lte("created_at", localDayToUtcRange(end, "end"));

  const { data: failedRows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Email lookup — single page covers the active user base. If we
  // outgrow 1000 we can paginate, but the current client roster is
  // well under that.
  const { data: authList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const emailById = new Map<string, string>();
  (authList?.users || []).forEach((u: any) =>
    emailById.set(u.id, u.email || "")
  );

  // Image tabs: anything that produced an image asset. Everything else
  // counts as video. fairytale-scene + image tabs are image; ugc / auto
  // / auto-content / cinema / clone / video → video.
  function isImageRow(r: any): boolean {
    const tab = String(r.tab || "").toLowerCase();
    const type = String(r.type || "").toLowerCase();
    return (
      tab === "image" ||
      type === "image" ||
      type === "fairytale-scene" ||
      tab === "fairytale-scene"
    );
  }

  // Admin's own test errors clutter the feed — hide rows owned by the
  // admin@gmail.com account so the table only shows real client errors.
  const adminUserIds = new Set<string>();
  (authList?.users || []).forEach((u: any) => {
    if ((u.email || "").toLowerCase() === "admin@gmail.com") {
      adminUserIds.add(u.id);
    }
  });
  const visibleRows = (failedRows || []).filter(
    (r: any) => !adminUserIds.has(r.user_id)
  );

  let videoCount = 0;
  let imageCount = 0;
  const rows = visibleRows.map((r: any) => {
    const meta = (r.metadata || {}) as Record<string, any>;
    const kind: "image" | "video" = isImageRow(r) ? "image" : "video";
    if (kind === "image") imageCount += 1;
    else videoCount += 1;

    // Provider chip: prefer metadata.slot ("p6-a"), fall back to
    // metadata.provider ("p6"), then tier_log[last].tier.
    let slot = String(meta.slot || "");
    if (!slot) {
      const tlog: any[] = Array.isArray(meta.tier_log) ? meta.tier_log : [];
      const last = tlog[tlog.length - 1];
      const parts = String(last?.tier || "").split(":");
      if (parts.length >= 2) slot = parts[1];
    }
    if (!slot) slot = String(meta.provider || "");

    return {
      id: r.id,
      user_id: r.user_id,
      email: emailById.get(r.user_id) || "—",
      tab: r.tab || r.type || "—",
      kind,
      slot,
      model: meta.model || "",
      error: r.error_message || "",
      created_at: r.created_at,
      prompt: r.prompt || "",
    };
  });

  // Surface the auto-resubmit cron heartbeat so the admin page can show
  // "last ran X min ago" — quickest tell whether the schedule is firing.
  const { data: hb } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "last_auto_resubmit_run")
    .maybeSingle();

  return NextResponse.json({
    rows,
    counts: { video: videoCount, image: imageCount, total: rows.length },
    cron: (hb?.value as any) || null,
  });
}
