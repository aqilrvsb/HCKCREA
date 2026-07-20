import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/editor/reset  { history_id }
//
// Reset an Editor video back to "fresh" — clears the generated Text (caption +
// cover title/subtitle + product stamp) and Cover, so the Text / Cover / Frame
// checkboxes reappear and it can be re-generated from scratch. Keeps the video
// in the Editor (in_editor stays true). Owner only, session-authed.
// (Framed rows aren't reset here — Undo Frame first.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.history_id || "").trim();
  if (!id) return NextResponse.json({ error: "history_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("id, user_id, metadata")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const m = { ...((row.metadata as Record<string, any>) || {}) };
  for (const k of ["cover_thumbnail_url", "cover_thumbnail_row", "cover_title", "cover_subtitle", "tiktok_product_id", "product_name", "caption"]) {
    delete m[k];
  }
  m.in_editor = true; // stays in the Editor, just cleared

  await admin.from("history").update({ caption: null, metadata: m }).eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
