import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GPU auto-stop is DISABLED (product decision): the GPU is never stopped
// automatically. Stopping is manual (admin/client) or via the provider's
// native scale-to-zero. This endpoint is a no-op kept so any existing cron
// schedule doesn't 404.
export async function GET() {
  return NextResponse.json({ ok: true, disabled: true, note: "GPU auto-stop disabled" });
}
