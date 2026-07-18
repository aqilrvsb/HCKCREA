import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { filterVisibleToClient } from "@/lib/server-history-visibility";
import { malaysiaDayToUtcRange } from "@/lib/date-util";
import { isInternalError } from "@/lib/retry-eligibility";

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

  const admin = createAdminClient();
  // Surface FAILED rows AND STUCK PENDING rows (pending + an error_message
  // that was never cleared). The auto-resubmit cron flips failed→pending when
  // it re-fires; a row that then re-failed and got stuck would vanish from a
  // failed-only feed, so the admin couldn't see or Resubmit it. Actively
  // retrying rows clear error_message on re-fire, so the not-null gate keeps
  // those transient in-flight rows out — only genuinely stuck ones appear.
  let q = admin
    .from("history")
    .select(
      "id, user_id, project_id, task_id, type, tab, status, error_message, metadata, created_at, prompt"
    )
    .in("status", ["failed", "pending"])
    .not("error_message", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (start) q = q.gte("created_at", malaysiaDayToUtcRange(start, "start"));
  if (end) q = q.lte("created_at", malaysiaDayToUtcRange(end, "end"));

  const { data: rawFailedRows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Only surface errors that the client can still see in their own
  // dashboard. Hard-deleted rows already missing from this SELECT;
  // this filter drops TTL-expired-and-unsaved rows so admin doesn't
  // chase ghost entries.
  const failedRows = await filterVisibleToClient(rawFailedRows || []);

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

  // Filter to internal-error-class failures only. Per user direction:
  // "at admin error also only show internal error". Content moderation,
  // audio-gen, rate-limit, validator, auth failures, etc. are not
  // admin-actionable (re-firing same row won't help) — user resolves
  // them on their own dashboard. Same gate used by all retry paths so
  // admin only sees rows that the system could/should retry.
  //
  // NOTE: previously this ALSO excluded rows owned by admin@gmail.com to
  // keep test errors out of the feed. Removed per user direction
  // 2026-06-29 — admin tests Original Video / UGC / Auto Content on the
  // admin account itself and needs those failures to surface here.
  const visibleRows = (failedRows || []).filter(
    (r: any) => isInternalError(r.error_message)
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
      task_id: r.task_id || "",
      // Reference attachments sent with this generation — so the admin can
      // see them and strip a bad one (e.g. a content-policy-blocked product
      // photo) before a manual Resubmit.
      image_urls: Array.isArray(meta.image_urls)
        ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
        : [],
      // How many times the auto-resubmit cron has re-fired this row.
      // Capped at 3 (MAX_AUTO_RESUBMIT). If a row sits on /admin/errors
      // with auto_count=3 the cron won't touch it anymore — admin must
      // manually Resubmit to give it another chance.
      auto_count: Number(meta.auto_resubmit_count || 0),
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
