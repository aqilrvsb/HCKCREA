import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/attachments/[id] — rename. Body: { name: string }
// DELETE /api/attachments/[id] — remove from B2 + DB.
// Both routes RLS-scoped to the signed-in user.

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const updates: { name?: string; category?: "product" | "avatar" } = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (name.length > 200) {
      return NextResponse.json({ error: "Name too long (max 200)" }, { status: 400 });
    }
    updates.name = name;
  }
  if (typeof body?.category === "string") {
    const cat = body.category.toLowerCase();
    if (cat !== "product" && cat !== "avatar") {
      return NextResponse.json({ error: "category must be 'product' or 'avatar'" }, { status: 400 });
    }
    updates.category = cat;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("attachments")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, attachment: data });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the row first so we know which B2 key to delete. RLS protects
  // cross-user reads — if the row isn't returned, we don't have permission.
  const { data: row, error: selErr } = await sb
    .from("attachments")
    .select("id, b2_key")
    .eq("id", id)
    .single();

  if (selErr || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort B2 delete — DB delete is the source of truth. If B2 fails
  // we still remove the DB row so the user's library is clean.
  if (row.b2_key) {
    try {
      await deleteObject({ key: row.b2_key });
    } catch (e: any) {
      console.warn(`[attachments] B2 delete failed for ${row.b2_key}:`, e?.message);
    }
  }

  const admin = createAdminClient();
  const { error: delErr } = await admin
    .from("attachments")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
