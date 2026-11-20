import { NextResponse } from "next/server";
import { checkToapisBalanceAndAlert } from "@/lib/toapis-balance";

// GET /api/worker/toapis-balance — Vercel Cron (every 15 min).
// Reads the ToAPIs account balance and WhatsApps the admins when it drops
// under app_settings.toapis_low_balance_usd. See lib/toapis-balance.ts.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await checkToapisBalanceAndAlert();
  return NextResponse.json(result);
}
