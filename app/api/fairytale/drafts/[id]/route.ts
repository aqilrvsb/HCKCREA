import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// /api/fairytale/drafts/[id]
//
// GET    → fetch one draft's full state for resume (returns the whole
//          state JSONB so the wizard can rehydrate every field).
// DELETE → remove a draft (Drafts tab trash icon, future).
//
// RLS-equivalent gating via .eq("user_id", user.id) on every query.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fairytale_drafts")
    .select("id, project_id, title, step, state, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, draft: data });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("fairytale_drafts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
