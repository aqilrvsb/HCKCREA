import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/fairytale/recent — list this user's most recent
// fairytale rows with status + output_url + error_message.
// Diagnostic only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("history")
    .select("id, type, status, output_url, error_message, created_at")
    .eq("user_id", user.id)
    .eq("type", "fairytale")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: !error,
    error: error?.message,
    rows: (data || []).map((r) => ({
      id: r.id,
      status: r.status,
      output_url_kind: r.output_url
        ? r.output_url.includes("backblazeb2.com")
          ? "B2"
          : r.output_url.includes("supabase.co")
            ? "SUPABASE"
            : "OTHER"
        : null,
      output_url_head: r.output_url?.slice(0, 80),
      error_message: r.error_message,
      created_at: r.created_at,
    })),
  });
}
