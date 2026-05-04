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
  if (typeFilter && typeFilter !== "fairytale" && typeFilter !== "fairytale-scene") {
    q = q.eq("type", typeFilter);
  }
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

  // ── Synthetic storytelling entries ──
  // Storytelling rows (merged videos + per-scene images) live in the
  // `history` table, not the `storage` table. We surface them here as
  // VIRTUAL storage items so the Storage UI shows them automatically
  // without requiring an explicit Save click. The merged video
  // (type=fairytale) is already permanent in B2 (Modal uploads it
  // there). Scene images (type=fairytale-scene) hold a 7-day Mountsea
  // signed URL — we surface them anyway so the user can browse what
  // was generated; the URL refresh only applies to actual storage rows.
  //
  // Dedupe: if a storytelling row was ALSO explicitly saved (real
  // storage row exists), prefer the storage row and skip the synthetic
  // duplicate.
  const includeFairytale =
    !typeFilter || typeFilter === "fairytale" || typeFilter === "fairytale-scene";
  let synthetic: any[] = [];
  if (includeFairytale) {
    const wantTypes =
      typeFilter === "fairytale"
        ? ["fairytale"]
        : typeFilter === "fairytale-scene"
          ? ["fairytale-scene"]
          : ["fairytale", "fairytale-scene"];
    const { data: storyRows } = await admin
      .from("history")
      .select("id, type, output_url, thumbnail_url, metadata, created_at")
      .eq("user_id", user.id)
      .in("type", wantTypes)
      .eq("status", "done")
      .not("output_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const savedHistoryIds = new Set(
      (refreshed || [])
        .filter((r: any) => r.type === "fairytale" || r.type === "fairytale-scene")
        .map((r: any) => r.history_id)
    );
    synthetic = (storyRows || [])
      .filter((r: any) => !savedHistoryIds.has(r.id))
      .map((r: any) => ({
        // Prefix the id so it doesn't collide with real storage UUIDs
        id: `hist:${r.id}`,
        history_id: r.id,
        type: r.type,
        b2_key: null,
        size_bytes: 0, // unknown — we don't HEAD the URL
        content_type: r.type === "fairytale" ? "video/mp4" : "image/png",
        cached_url: r.output_url,
        cached_url_exp: null,
        created_at: r.created_at,
        // synthetic flag — frontend hides Delete button on these because
        // they're owned by history, not storage. User can delete via the
        // history grid.
        synthetic: true,
        thumbnail_url: r.thumbnail_url || (r.type === "fairytale-scene" ? r.output_url : null),
      }));
  }

  // Merge + sort by created_at desc
  const merged = [...(refreshed || []), ...synthetic].sort(
    (a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Quota stats — count only real storage rows, since synthetic entries
  // don't occupy B2 space yet.
  const totalBytes = (rows || []).reduce((acc, r: any) => acc + Number(r.size_bytes || 0), 0);
  const quotaSetting = await getSetting<{ mb: number }>("storage_quota_per_user_mb");
  const quotaMb = Number(quotaSetting?.mb || 1024);

  return NextResponse.json({
    ok: true,
    items: merged,
    used_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    quota_mb: quotaMb,
    used_pct: Number(((totalBytes / (1024 * 1024)) / quotaMb * 100).toFixed(1)),
  });
}
