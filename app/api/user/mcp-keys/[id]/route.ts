import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// DELETE /api/user/mcp-keys/:id — revoke a key the logged-in user owns.
// Sets revoked_at; the key is rejected by validateMcpKey from this
// instant. We don't hard-delete the row so audit history (last_used_at,
// metadata.mcp_caller_id on existing history rows) stays interpretable.

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_mcp_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json({ error: "Revoke failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
