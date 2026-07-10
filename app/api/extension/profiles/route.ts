import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extension/profiles — list the user's PeningLab projects.
//
// The extension's Auto Post tab (v3.6+) calls these "Profiles": the user
// picks a profile first, then a source tab (Dialog UGC / Original Video /
// Auto Content / Auto UGC), and only then does /api/extension/recent
// populate videos scoped to that project.
export async function GET(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("id, name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Query failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    profiles: (data || []).map((p: any) => ({ id: p.id, name: p.name })),
  });
}
