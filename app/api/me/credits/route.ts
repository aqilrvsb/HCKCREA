import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/credits — tiny endpoint that returns the live credit balance
// for the signed-in user. Called by the dashboard shell on `history:refresh`
// so the sidebar Credit Balance widget reflects deductions immediately
// without waiting for the next page reload.
export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    ok: true,
    credits: Number(data?.credits || 0),
  });
}
