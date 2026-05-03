import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/admin/fairytale/poll-debug?ids=a,b,c
// Mirrors what the wizard's browser-side polling effect queries via the
// supabase browser client. Helps verify whether RLS is blocking those
// rows from the user's perspective.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") || "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids query param required" }, { status: 400 });
  }

  // Same query as the wizard polling — uses the user's session client
  const { data, error } = await sb
    .from("history")
    .select("id, status, output_url, user_id")
    .in("id", ids);

  return NextResponse.json({
    ok: true,
    user_id: user.id,
    requested: ids.length,
    returned: data?.length || 0,
    rows: data,
    error: error?.message || null,
  });
}
