import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getToapisAccountBalance, getToapisThresholdUsd, checkToapisBalanceAndAlert } from "@/lib/toapis-balance";

// Admin-only: GET shows the live ToAPIs account balance (for the settings
// card's "Check now"); POST runs the same check the cron does (may alert).

export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return !!profile?.is_admin;
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [bal, thresholdUsd] = await Promise.all([getToapisAccountBalance(), getToapisThresholdUsd()]);
  return NextResponse.json({ ...bal, thresholdUsd });
}

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await checkToapisBalanceAndAlert());
}
