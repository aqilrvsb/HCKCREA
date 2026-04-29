import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extension/info — public, unauthenticated. Used by the
// dashboard sidebar's "Auto Post TikTok" install modal so clients can
// see the current extension version + the Google Drive (or direct)
// download link without going through the email-gated /verify flow.
//
// Both fields come from app_settings:
//   - extension_version           { value: "3.1.9" }  (or { version: ... })
//   - extension_download_url      { url: "https://..." }
//
// Same data the /verify route returns inside its `extension` block;
// this is just the public-read sibling.
export async function GET() {
  const [versionSetting, downloadSetting] = await Promise.all([
    getSetting<any>("extension_version"),
    getSetting<any>("extension_download_url"),
  ]);
  const version =
    String(versionSetting?.value || versionSetting?.version || "").trim();
  const download_url = String(downloadSetting?.url || "").trim();
  return NextResponse.json({ version, download_url });
}
