import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadFromUrl, signedGetUrl, buildKey, bucketPrivate, type StorageType } from "@/lib/b2";
import { getSetting } from "@/lib/settings";

// POST /api/storage/save
// Body: { history_id }
// Looks up the history row, copies its temp Crun output_url into the user's
// B2 folder, records it in `storage` table, returns the new signed URL.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Detect whether a URL points at the public peninglab-content bucket.
// If so, the file is already on B2 — Save just records a storage row;
// no download + re-upload needed.
function isContentBucketUrl(url: string): boolean {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base) return false;
  return url.startsWith(base);
}

// Derive the B2 key from a peninglab-content public URL.
// Inverse of publicUrlForKey().
function keyFromContentUrl(url: string): string | null {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base || !url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\//, "");
}

// Only types with a final user-facing media output are savable.
// Excluded: fairytale-scene (intermediate frames merged into the final
// mp4 — user should save the merged result, not the per-scene images),
// clone (text-only prompt, no media file).
const ALLOWED_TYPES: StorageType[] = [
  "image", "video", "ugc", "auto", "cinema", "fairytale", "seedance",
];

function extFromUrlOrType(url: string, type: StorageType): string {
  // Best-effort extension from URL path; fall back by type
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,5})($|\?)/);
    if (m) return m[1].toLowerCase();
  } catch {}
  if (type === "image" || type === "fairytale-scene") return "png";
  return "mp4";
}

function contentTypeFor(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
  return "application/octet-stream";
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "");
  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });

  const admin = createAdminClient();

  // Fetch history row + verify ownership
  const { data: hist, error: histErr } = await admin
    .from("history")
    .select("id, user_id, type, output_url, status")
    .eq("id", historyId)
    .single();
  if (histErr || !hist) return NextResponse.json({ error: "History row not found" }, { status: 404 });
  if (hist.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (hist.status !== "done" || !hist.output_url) {
    return NextResponse.json({ error: "Asset not ready yet" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(hist.type as StorageType)) {
    return NextResponse.json(
      { error: `'${hist.type}' rows can't be saved. Save the merged final asset instead.` },
      { status: 400 }
    );
  }
  const type = hist.type as StorageType;

  // Idempotency — already saved?
  const { data: existing } = await admin
    .from("storage")
    .select("id, b2_key, cached_url")
    .eq("history_id", historyId)
    .maybeSingle();
  if (existing) {
    // Refresh the signed URL so frontend gets a working link
    const url = await signedGetUrl({ key: existing.b2_key });
    await admin
      .from("storage")
      .update({ cached_url: url, cached_url_exp: new Date(Date.now() + 7 * 86400_000).toISOString() })
      .eq("id", existing.id);
    return NextResponse.json({ ok: true, already_saved: true, url, key: existing.b2_key });
  }

  // Quota check
  const quotaSetting = await getSetting<{ mb: number }>("storage_quota_per_user_mb");
  const quotaMb = Number(quotaSetting?.mb || 1024);
  const { data: usage } = await admin
    .from("storage")
    .select("size_bytes")
    .eq("user_id", user.id);
  const usedBytes = (usage || []).reduce((acc, r: any) => acc + Number(r.size_bytes || 0), 0);
  const usedMb = usedBytes / (1024 * 1024);
  if (usedMb >= quotaMb) {
    return NextResponse.json(
      { error: `Storage quota full (${usedMb.toFixed(1)} / ${quotaMb} MB). Delete some files or upgrade.` },
      { status: 402 }
    );
  }

  // Fast path: history.output_url is ALREADY on peninglab-content (auto-mirrored
  // at gen time). Skip the download+upload — just record a storage row pointing
  // at the existing key, and use the public URL as the cached_url. Quota still
  // counts the file against the user's 1024MB.
  if (isContentBucketUrl(hist.output_url)) {
    const contentKey = keyFromContentUrl(hist.output_url);
    if (!contentKey) {
      return NextResponse.json(
        { error: "Failed to parse content-bucket URL" },
        { status: 500 }
      );
    }

    const ext = extFromUrlOrType(hist.output_url, type);
    const ctype = contentTypeFor(ext);

    // HEAD the public URL to get size_bytes — needed for quota accounting.
    let sizeBytes = 0;
    try {
      const h = await fetch(hist.output_url, { method: "HEAD" });
      const cl = h.headers.get("content-length");
      sizeBytes = cl ? Number(cl) : 0;
    } catch {
      sizeBytes = 0; // best-effort
    }

    await admin.from("storage").insert({
      user_id: user.id,
      history_id: historyId,
      type,
      b2_bucket: process.env.B2_CONTENT_BUCKET || "peninglab-content",
      b2_key: contentKey,
      size_bytes: sizeBytes,
      content_type: ctype,
      source_url: hist.output_url,
      // cached_url is the same stable public URL — no expiry needed but
      // the column is NOT NULL with a future date for back-compat.
      cached_url: hist.output_url,
      cached_url_exp: new Date(Date.now() + 5 * 365 * 86400_000).toISOString(),
    });

    return NextResponse.json({
      ok: true,
      saved: true,
      url: hist.output_url,
      key: contentKey,
      size_bytes: sizeBytes,
      used_mb: ((usedBytes + sizeBytes) / (1024 * 1024)).toFixed(2),
      quota_mb: quotaMb,
      fast_path: true,
    });
  }

  // Slow path (legacy): output_url is still a provider URL (mirror failed,
  // or this is a pre-feature row that hasn't been backfilled yet).
  // Download + upload to peninglab-storage like before.
  const ext = extFromUrlOrType(hist.output_url, type);
  const key = buildKey({ userId: user.id, type, historyId, ext });
  const ctype = contentTypeFor(ext);

  let uploaded;
  try {
    uploaded = await uploadFromUrl({
      url: hist.output_url,
      key,
      contentType: ctype,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Save failed: ${e?.message || "B2 upload error"}` },
      { status: 502 }
    );
  }

  // Mint a 7-day signed URL the frontend can cache
  const signedUrl = await signedGetUrl({ key });

  await admin.from("storage").insert({
    user_id: user.id,
    history_id: historyId,
    type,
    b2_bucket: bucketPrivate(),
    b2_key: key,
    size_bytes: uploaded.size,
    content_type: ctype,
    source_url: hist.output_url,
    cached_url: signedUrl,
    cached_url_exp: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });

  return NextResponse.json({
    ok: true,
    saved: true,
    url: signedUrl,
    key,
    size_bytes: uploaded.size,
    used_mb: ((usedBytes + uploaded.size) / (1024 * 1024)).toFixed(2),
    quota_mb: quotaMb,
  });
}
