import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/verify
// Body: { extension_version }
//
// The PeningLab Chrome extension calls this on every launch (and after
// login) to gate access. We auth via the standard Supabase session
// cookies — the extension forwards the user's PeningLab session to
// this domain, so the user must be logged into peninglab.com first.
//
// Auth model:
//   1. Must have a Supabase session (signed-in user)
//   2. plan_active must be true (paid Pro subscription, not expired)
//   3. extension_version must match the admin's app_settings value
//
// Returns:
//   { ok: true, user, plan, extension }
//   on any failure → 401/403 with reason
//
// Deliberately does NOT check credit balance — admin's subscription gate
// is what unlocks the extension; per-generation cost is metered server-side.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in. Login at peninglab.com first." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const clientVersion = String(body?.extension_version || "").trim();

  // Pull plan + admin extension settings in parallel.
  const admin = createAdminClient();
  const [profileRes, versionSetting, downloadSetting] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, plan, plan_expires_at, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    getSetting<any>("extension_version"),
    getSetting<any>("extension_download_url"),
  ]);

  const profile = profileRes.data;
  const requiredVersion = String(versionSetting?.value || versionSetting?.version || "").trim();
  const downloadUrl = String(downloadSetting?.url || "").trim();

  const planExpiresAt = profile?.plan_expires_at as string | null;
  const planActive =
    profile?.plan === "pro" &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();

  if (!planActive) {
    return NextResponse.json(
      {
        ok: false,
        error: "Pro subscription required. Renew at peninglab.com/dashboard?view=billing.",
        plan_active: false,
      },
      { status: 403 }
    );
  }

  // Version mismatch isn't a hard fail — we want the extension to still
  // boot so the user can SEE the update prompt. Return ok with a flag.
  const versionOk =
    !requiredVersion || !clientVersion || clientVersion === requiredVersion;

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: profile?.full_name || user.email?.split("@")[0] || "User",
      is_admin: !!profile?.is_admin,
    },
    plan: {
      active: true,
      tier: profile?.plan,
      expires_at: planExpiresAt,
    },
    extension: {
      required_version: requiredVersion,
      client_version: clientVersion,
      version_ok: versionOk,
      download_url: downloadUrl || null,
    },
  });
}
