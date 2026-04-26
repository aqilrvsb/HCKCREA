import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/history/delete?id=<history_id>
// User-scoped: RLS on history table ensures users can only delete their own
// rows. We use the regular client (not admin) to honor that.
export async function DELETE(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await sb.from("history").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
