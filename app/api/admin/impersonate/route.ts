import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/impersonate
// Body: { user_id: string }
//
// Generates a one-time magic-link login URL for the target user using
// Supabase's admin API. Returns { url } so the caller can window.open()
// the URL in a new tab — the new tab is auto-signed-in as the target
// user without ever exposing their password. Admin's own session in
// the original tab is untouched.
//
// Auth model:
//   1. Caller must have a Supabase session (admin layout already enforces
//      this), AND
//   2. profiles.is_admin must be true on the caller's user_id.
//
// Magic link defaults to 1-hour expiry on the Supabase side; the URL
// is single-use and consumed when the new tab loads.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user: caller },
  } = await sb.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin gate — only profiles.is_admin = true users can impersonate.
  const admin = createAdminClient();
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", caller.id)
    .maybeSingle();
  if (!callerProfile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const targetUserId = String(body?.user_id || "").trim();
  if (!targetUserId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Look up the target user's email — needed for generateLink. Admin
  // client bypasses RLS so we can read any user's auth row.
  const { data: targetData, error: lookupErr } =
    await admin.auth.admin.getUserById(targetUserId);
  if (lookupErr || !targetData?.user) {
    return NextResponse.json(
      { error: "Target user not found" },
      { status: 404 }
    );
  }
  const targetEmail = targetData.user.email;
  if (!targetEmail) {
    return NextResponse.json(
      { error: "Target user has no email — cannot generate magic link" },
      { status: 400 }
    );
  }

  // Generate one-time magic link. Supabase returns an action_link the
  // browser can navigate to; the link consumes the token + sets the
  // session cookies for the target user.
  //
  // redirectTo points at /auth/handoff (a client component) instead of
  // /dashboard directly because Supabase magic links return tokens in
  // the URL hash (#access_token=...). Server components can't read the
  // hash, so /dashboard alone would 401-redirect. /auth/handoff parses
  // the hash, writes session cookies, then forwards to /dashboard.
  const origin =
    req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (origin?.includes("localhost") ? "http" : "https");
  const redirectTo = origin
    ? `${proto}://${origin}/auth/handoff?next=/dashboard`
    : undefined;

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: redirectTo ? { redirectTo } : undefined,
    });
  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message || "Failed to generate login link" },
      { status: 500 }
    );
  }

  // Audit trail — best-effort log. Skips silently if the table is missing.
  try {
    await admin.from("admin_impersonation_log").insert({
      admin_user_id: caller.id,
      target_user_id: targetUserId,
      target_email: targetEmail,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Table may not exist yet — non-fatal.
  }

  return NextResponse.json({
    ok: true,
    url: linkData.properties.action_link,
    target_email: targetEmail,
  });
}
