import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedGetUrl } from "@/lib/b2";
import { getSetting } from "@/lib/settings";

// GET /api/storage/list?type=fairytale (optional filter)
//
// Returns the user's saved-to-storage files as { items, used_mb, quota_mb }.
// Refreshes any signed URLs that have less than 1 day left so the frontend
// always renders working links.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type");

  const admin = createAdminClient();
  let q = admin
    .from("storage")
    .select("id, history_id, type, b2_key, size_bytes, content_type, cached_url, cached_url_exp, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (typeFilter) q = q.eq("type", typeFilter);
  const { data: rows } = await q;

  // Refresh any signed URL that's within 24h of expiring (cheap — only the
  // ones nearing expiry, not all on every load).
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const refreshed = await Promise.all(
    (rows || []).map(async (r: any) => {
      const exp = r.cached_url_exp ? new Date(r.cached_url_exp).getTime() : 0;
      if (exp - now > oneDay && r.cached_url) return r;
      try {
        const newUrl = await signedGetUrl({ key: r.b2_key });
        await admin
          .from("storage")
          .update({ cached_url: newUrl, cached_url_exp: new Date(now + 7 * oneDay).toISOString() })
          .eq("id", r.id);
        return { ...r, cached_url: newUrl };
      } catch {
        return r;
      }
    })
  );

  // Quota stats
  const totalBytes = (rows || []).reduce((acc, r: any) => acc + Number(r.size_bytes || 0), 0);
  const quotaSetting = await getSetting<{ mb: number }>("storage_quota_per_user_mb");
  const quotaMb = Number(quotaSetting?.mb || 1024);

  return NextResponse.json({
    ok: true,
    items: refreshed,
    used_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    quota_mb: quotaMb,
    used_pct: Number(((totalBytes / (1024 * 1024)) / quotaMb * 100).toFixed(1)),
  });
}
