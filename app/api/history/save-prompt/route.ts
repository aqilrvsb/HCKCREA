import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/history/save-prompt { history_id, prompt }
//
// Persists an edited prompt to a failed history row WITHOUT firing the
// cascade. Companion to /api/history/retry — lets users save their
// edit first (e.g. to keep a longer rewrite they're refining) and
// click Resubmit later.
//
// Auth: caller must own the row. Row must be in `failed` state — we
// don't allow editing prompts on done / pending rows because those
// have either already settled or are mid-flight and a prompt change
// would create a mismatch between the stored prompt and the task at
// the upstream provider.

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("id, user_id, status")
    .eq("id", historyId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.status !== "failed") {
    return NextResponse.json(
      { error: `Cannot edit prompt — row is '${row.status}'. Only failed rows are editable.` },
      { status: 400 }
    );
  }

  const { error: updErr } = await admin
    .from("history")
    .update({ prompt })
    .eq("id", historyId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
