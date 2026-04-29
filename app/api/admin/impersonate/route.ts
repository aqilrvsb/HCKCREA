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

  // Mint a session for the target user — peningbot pattern:
  //   1. generateLink({ type: 'magiclink' }) → returns action_link with
  //      a one-time token in its query string
  //   2. parse the token from the action_link
  //   3. verifyOtp() server-side using the service-role admin client →
  //      consumes the token, returns a real { access_token, refresh_token }
  //   4. return the session JSON to the caller
  //
  // The browser then calls supabase.auth.setSession() with these tokens
  // to log in as the target user. No URL-hash round-trip needed; no
  // need for a /auth/callback bounce.
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });
  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message || "Failed to generate login link" },
      { status: 500 }
    );
  }

  // Pull the OTP token out of the action_link's query string.
  let tokenHash: string | null = null;
  try {
    const linkUrl = new URL(linkData.properties.action_link);
    tokenHash = linkUrl.searchParams.get("token");
  } catch {
    // fall through
  }
  if (!tokenHash) {
    return NextResponse.json(
      { error: "Failed to parse token from magic link" },
      { status: 500 }
    );
  }

  // Verify the OTP server-side to get the actual session tokens. Uses
  // the service-role admin client so we don't burn the OTP via the
  // user-scoped supabase ssr client.
  const { data: verifyData, error: verifyErr } = await admin.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr || !verifyData?.session) {
    return NextResponse.json(
      { error: verifyErr?.message || "Failed to verify magic-link token" },
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
    session: {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    },
    target_email: targetEmail,
  });
}
