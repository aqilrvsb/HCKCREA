import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { authExtensionUser } from "@/lib/extension-auth";
import { canUseAutoPost } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extension/verify
// Body: { extension_version, email? }
// Auth: x-pl-email header             (email-only mode — extension default)
//       OR Authorization: Bearer ...   (token mode)
//       OR Supabase session cookies    (browser tab)
//
// If `email` is in the body but no x-pl-email header is set, we promote
// it to the header for this request. Lets the extension's first /verify
// call work without forcing the user to round-trip the email through
// chrome.storage before the first request.
//
// The PeningLab Chrome extension calls this on every launch to gate
// access. The extension authenticates with the user's Supabase
// access_token (obtained from peninglab Supabase auth.signInWithPassword)
// and sends it as a Bearer header — Chrome extensions can't reliably
// forward third-party session cookies.
//
// Auth model:
//   1. Must resolve to a valid user (Bearer or cookie)
//   2. plan_active must be true (paid Pro subscription, not expired)
//   3. extension_version is reported as match/mismatch but doesn't hard-fail
//      so the extension can still boot and show the update prompt.
//
// Deliberately does NOT check credit balance — admin's subscription gate
// is what unlocks the extension; per-generation cost is metered server-side.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const clientVersion = String(body?.extension_version || "").trim();
  const bodyEmail = String(body?.email || "").trim().toLowerCase();

  // If body carries an email but the header doesn't, synthesize the
  // header so authExtensionUser's mode-1 lookup picks it up.
  let headersWithEmail = req.headers;
  if (bodyEmail && !req.headers.get("x-pl-email")) {
    const h = new Headers(req.headers);
    h.set("x-pl-email", bodyEmail);
    headersWithEmail = h;
  }
  const proxiedReq = new Request(req.url, {
    method: req.method,
    headers: headersWithEmail,
  });

  const user = await authExtensionUser(proxiedReq);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error:
          bodyEmail
            ? `Email "${bodyEmail}" not found. Daftar di peninglab.com dulu.`
            : "Email required.",
      },
      { status: 401 }
    );
  }

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

  // Auto Post is gated by AUTO_POST_TIERS (standard / pro / premium) in
  // lib/plans.ts — NOT a hardcoded "pro" string. Premium is a HIGHER tier
  // than Pro, so an exact === "pro" check wrongly locked Premium users out.
  const planExpiresAt = profile?.plan_expires_at as string | null;
  const planActive =
    canUseAutoPost(profile?.plan) &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();

  if (!planActive) {
    return NextResponse.json(
      {
        ok: false,
        error: "Pelan Standard/Pro/Premium aktif diperlukan. Renew di peninglab.com/dashboard?view=billing.",
        plan_active: false,
      },
      { status: 403 }
    );
  }

  // Version check uses STRICT EQUALITY — admin's extension_version is
  // the EXACT required version. Clients running anything else (older OR
  // newer) get flagged so the side panel can show the update prompt.
  // This lets admin pin a precise build for support / rollout-control,
  // not just a minimum floor. If either value is missing we let the
  // client through so the extension can still boot before admin
  // configures the gate.
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
