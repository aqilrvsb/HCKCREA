import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/b2";

// POST /api/storage/delete  Body: { storage_id }
// Removes the B2 object + the storage row. The history row (if it still
// exists) keeps its temp URL for as long as Crun keeps it alive.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.storage_id || "");
  if (!id) return NextResponse.json({ error: "storage_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("storage")
    .select("id, user_id, b2_bucket, b2_key")
    .eq("id", id)
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await deleteObject({ key: row.b2_key, bucket: row.b2_bucket });
  } catch {
    // Even if B2 delete fails (rare), drop our record so user can re-save
  }
  await admin.from("storage").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
