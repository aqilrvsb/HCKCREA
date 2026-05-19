import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

// GET /api/fb-pixel/config
// Returns the public Facebook Pixel ID (NOT the access token) so the
// browser Pixel snippet can initialize itself. The access_token is
// SERVER-ONLY and never sent to the client — that key signs CAPI
// requests and would be a major security incident if leaked.
//
// Unauthenticated — pixel ID is meant to be visible in the HTML source
// anyway (any user can View Source on a public page and see fbq init).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Default Pixel ID for peninglab.com — the production Meta Pixel
// installed at Events Manager. Used as fallback when admin hasn't
// configured a custom fb_capi.pixel_id setting. Admin can override
// via /admin/settings → Facebook Conversions API section.
const DEFAULT_PIXEL_ID = "1511282347248812";

export async function GET() {
  const cfg = await getSetting<{
    pixel_id?: string;
    access_token?: string;
    test_event_code?: string;
    enabled?: boolean;
  }>("fb_capi");

  // Hard-disabled via admin → don't ship any pixel.
  if (cfg?.enabled === false) {
    return NextResponse.json({ ok: true, enabled: false, pixel_id: null });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    pixel_id: cfg?.pixel_id || DEFAULT_PIXEL_ID,
    // test_event_code is shown to the client too because Meta's Pixel
    // accepts it via a fbq('init', ..., { ... }) options object during
    // testing windows. Don't enable test_event_code in production.
    test_event_code: cfg?.test_event_code || null,
  });
}
