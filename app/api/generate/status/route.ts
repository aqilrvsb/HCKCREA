import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleHistoryRow } from "@/lib/settle";

// GET /api/generate/status?id=<history_id>
// Browser-driven poll. Reads the history row, settles it against P2 if
// still pending, returns the (possibly updated) row. Same settle helper
// is used by /api/worker/poll-pending so server-side and client-side
// pollers stay in sync.
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: hist } = await admin
    .from("history")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!hist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settle = await settleHistoryRow(hist);

  if (settle.state === "settled" || settle.state === "skipped") {
    const { data: refreshed } = await admin
      .from("history")
      .select("*")
      .eq("id", id)
      .single();
    return NextResponse.json({ ok: true, history: refreshed });
  }

  // Still pending — return current row + remote P2 status for debug
  return NextResponse.json({ ok: true, history: hist, p2_status: settle.p2Status });
}
