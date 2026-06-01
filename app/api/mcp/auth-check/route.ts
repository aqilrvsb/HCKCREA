import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/auth-check — validates the API key and returns the
// account info bound to it. Used by the npm package on first call
// (and by `peninglab-mcp test` if we ever add a CLI command) to
// confirm the key is configured correctly.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("email, credits, plan")
    .eq("id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    user_id: auth.userId,
    key_prefix: auth.keyPrefix,
    email: profile?.email ?? null,
    balance: Number(profile?.credits ?? 0),
    plan: profile?.plan ?? "light",
  });
}
