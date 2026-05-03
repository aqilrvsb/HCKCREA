import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/storage/status  Body: { history_ids: [uuid, ...] }
// Returns map of history_id → { saved: boolean, storage_id?: uuid, url?: string }
// Used by the history grid to render Save / Saved badges per row in one
// roundtrip instead of N.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.history_ids) ? body.history_ids.slice(0, 200) : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, statuses: {} });

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("storage")
    .select("id, history_id, cached_url")
    .eq("user_id", user.id)
    .in("history_id", ids);

  const statuses: Record<string, { saved: boolean; storage_id?: string; url?: string }> = {};
  for (const id of ids) statuses[id] = { saved: false };
  for (const r of rows || []) {
    if (r.history_id) statuses[r.history_id] = { saved: true, storage_id: r.id, url: r.cached_url || undefined };
  }

  return NextResponse.json({ ok: true, statuses });
}
