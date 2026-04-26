import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/history/rename
// Body: { id: string, name: string }
// Stores user-supplied name into history.metadata.name. Used by the
// per-card "Name" field; download then uses it as the filename.
// User-scoped via RLS (we double-check ownership before write).
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const name = String(body?.name || "").substring(0, 80);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("metadata, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextMeta = { ...(row.metadata || {}), name };
  await admin.from("history").update({ metadata: nextMeta }).eq("id", id);

  return NextResponse.json({ ok: true });
}
