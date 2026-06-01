import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/balance — return current credit balance for the
// account bound to the API key. Stateless, no side effects.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("credits, plan")
    .eq("id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    balance: Number(profile?.credits ?? 0),
    plan: profile?.plan ?? "light",
  });
}
