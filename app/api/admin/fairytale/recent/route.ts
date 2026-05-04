import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/fairytale/recent — list this user's most recent
// fairytale rows with status + output_url + error_message.
// Diagnostic only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const url = new URL(req.url);
  // ?kind=scene returns the scene-image rows (type='fairytale-scene')
  // instead of the merged-video rows. Useful for diagnosing image-gen
  // failures (Crun/Mountsea/Gemini errors land in the scene rows, not
  // the merge row).
  const kind = url.searchParams.get("kind") || "merged";
  const onlyFailed = url.searchParams.get("failed") === "1";
  const filterType = kind === "scene" ? "fairytale-scene" : "fairytale";
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 15));

  let q = admin
    .from("history")
    .select("id, type, status, output_url, error_message, metadata, created_at")
    .eq("user_id", user.id)
    .eq("type", filterType)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (onlyFailed) q = q.eq("status", "failed");
  const { data, error } = await q;

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
            : r.output_url.includes("mountseaapi") || r.output_url.includes("dkkj.s3")
              ? "MOUNTSEA"
              : "OTHER"
        : null,
      output_url_head: r.output_url?.slice(0, 80),
      provider: (r.metadata as any)?.provider || null,
      scene_idx: (r.metadata as any)?.scene_idx ?? null,
      group_id: (r.metadata as any)?.group_id ?? null,
      model: (r.metadata as any)?.model ?? null,
      error_message: r.error_message,
      created_at: r.created_at,
    })),
  });
}
