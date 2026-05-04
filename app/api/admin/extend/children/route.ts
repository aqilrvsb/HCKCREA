import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/extend/children?parents=id1,id2,id3
//
// Returns seg-2 (extend) child rows for the given parent video IDs.
// Diagnostic only — used by the QA harness to verify that an extend
// generation completed and to inspect the seg2 prompt that was sent.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parentIds = (url.searchParams.get("parents") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parentIds.length === 0) {
    return NextResponse.json({ error: "parents= required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("history")
    .select(
      "id, parent_history_id, status, output_url, error_message, prompt, metadata, created_at, segment_index, merged_url"
    )
    .eq("user_id", user.id)
    .in("parent_history_id", parentIds)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    ok: !error,
    error: error?.message,
    rows: (data || []).map((r) => ({
      id: r.id,
      parent: r.parent_history_id,
      status: r.status,
      segment_index: r.segment_index,
      output_url: r.output_url,
      merged_url: r.merged_url,
      error_message: r.error_message,
      created_at: r.created_at,
      anchor_frame_url: (r.metadata as any)?.anchor_frame_url,
      end_frame_url: (r.metadata as any)?.end_frame_url,
      seg2_prompt_head: r.prompt?.slice(0, 400),
      seg2_prompt_len: r.prompt?.length || 0,
    })),
  });
}
