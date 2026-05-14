import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadBufferToStoragePublic } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/attachments/import-from-urls
//   body: { urls: string[], name?: string, category?: "product" | "avatar" }
//   resp: { ok: true, imported: number, skipped: number, attachments: Row[] }
//
// Server-side fetches each URL, rehosts it on peninglab-storage B2, and
// inserts an Attachment row for the user. Used by the Scrape flow so
// scraped Google Images become permanent assets in the user's library
// instead of one-shot URLs that may break or change.

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_URLS_PER_REQUEST = 5;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function extFor(ct: string): string {
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "jpg";
}

function normalizeCt(ct: string | null): string {
  if (!ct) return "image/jpeg";
  // Drop charset / boundary noise. Some CDNs return "image/jpeg; charset=binary".
  return ct.split(";")[0].trim().toLowerCase() || "image/jpeg";
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const urls: string[] = Array.isArray(body?.urls) ? body.urls.filter((u: unknown) => typeof u === "string") : [];
  if (urls.length === 0) {
    return NextResponse.json({ error: "urls is required" }, { status: 400 });
  }
  if (urls.length > MAX_URLS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many URLs (max ${MAX_URLS_PER_REQUEST})` },
      { status: 400 }
    );
  }
  const providedName = String(body?.name || "").trim();
  const rawCat = String(body?.category || "product").toLowerCase();
  const category: "product" | "avatar" = rawCat === "avatar" ? "avatar" : "product";
  const defaultName =
    providedName || `Scraped ${new Date().toISOString().slice(0, 10)}`;

  const admin = createAdminClient();
  const imported: any[] = [];
  let skipped = 0;

  for (const rawUrl of urls) {
    try {
      const fetched = await fetch(rawUrl, {
        method: "GET",
        signal: AbortSignal.timeout(20_000),
        // Some Google Images thumbnails 403 without a referer/UA combo.
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        },
      });
      if (!fetched.ok) {
        skipped++;
        continue;
      }
      const ct = normalizeCt(fetched.headers.get("content-type"));
      if (!ALLOWED_TYPES.has(ct)) {
        skipped++;
        continue;
      }
      const ab = await fetched.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > MAX_BYTES) {
        skipped++;
        continue;
      }
      const buffer = Buffer.from(ab);

      const { data: pending, error: insErr } = await admin
        .from("attachments")
        .insert({
          user_id: user.id,
          name: defaultName,
          b2_key: "",
          public_url: "",
          content_type: ct,
          size_bytes: buffer.length,
          category,
        })
        .select("id")
        .single();
      if (insErr || !pending) {
        skipped++;
        continue;
      }

      const key = `attachments/${user.id}/${pending.id}.${extFor(ct)}`;
      let publicUrl = "";
      try {
        const r = await uploadBufferToStoragePublic({
          body: buffer,
          key,
          contentType: ct,
        });
        publicUrl = r.publicUrl;
      } catch {
        // Roll back the placeholder row so the library never shows a broken card.
        await admin.from("attachments").delete().eq("id", pending.id);
        skipped++;
        continue;
      }

      const { data: row } = await admin
        .from("attachments")
        .update({ b2_key: key, public_url: publicUrl })
        .eq("id", pending.id)
        .select("*")
        .single();
      if (row) imported.push(row);
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    imported: imported.length,
    skipped,
    attachments: imported,
  });
}
