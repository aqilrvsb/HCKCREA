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

  // profiles holds the wallet (credits) + plan. Email lives on auth.users —
  // not duplicated to profiles. Fetch both in parallel so a slow auth lookup
  // doesn't add latency.
  const [profileRes, userRes] = await Promise.all([
    admin
      .from("profiles")
      .select("credits, plan, full_name")
      .eq("id", auth.userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(auth.userId),
  ]);

  const profile = profileRes.data;
  const email = userRes.data?.user?.email ?? null;

  return NextResponse.json({
    ok: true,
    user_id: auth.userId,
    key_prefix: auth.keyPrefix,
    email,
    full_name: profile?.full_name ?? null,
    balance: Number(profile?.credits ?? 0),
    plan: profile?.plan ?? "light",
  });
}
