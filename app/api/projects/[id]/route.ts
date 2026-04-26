import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/projects/:id — rename. Body: { name }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim().substring(0, 60);
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { error } = await sb
    .from("projects")
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/projects/:id — removes project. History rows have project_id
// nulled (kept; users can still see them in unscoped history if we ever add it).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { error } = await sb
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
