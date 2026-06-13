import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Public: current Livehost extension version + download URL, for the client
// dashboard "TikTok Live" page (install/update). Mirrors /api/extension/info.
export async function GET() {
  const s = await getSettings(["livehost_ext_version", "livehost_ext_download_url"]);
  return NextResponse.json({
    version: String(s["livehost_ext_version"] || "").trim(),
    download_url: String(s["livehost_ext_download_url"] || "").trim(),
  });
}
