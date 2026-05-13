import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/attachments/transferred
// Returns the set of history_ids that the user has already transferred
// into their Attachments library. Used by the image-tab history cards
// to show a "transferred" state on the Transfer button.

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("attachments")
    .select("source_history_id")
    .not("source_history_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data || [])
    .map((r: any) => r.source_history_id as string | null)
    .filter((x: string | null): x is string => !!x);

  return NextResponse.json({ ok: true, history_ids: ids });
}
