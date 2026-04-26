import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/upload/image
// Accepts multipart/form-data with field 'file' (Blob) or JSON with { dataUrl }.
// Uploads to Supabase Storage (bucket 'demos', prefix 'user-uploads/<user_id>/')
// and returns a public CDN URL that Crun.ai accepts as img_urls input.
//
// Crun.ai cannot accept data: URLs — only HTTPS URIs. This is the bridge.

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB — covers high-res photos, blocks abuse
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const BUCKET = "demos";
const PREFIX = "user-uploads";

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let bytes: Buffer;
  let contentType: string;
  let ext: string;

  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: "No file" }, { status: 400 });
      }
      contentType = file.type || "image/png";
      if (!ALLOWED_TYPES.includes(contentType)) {
        return NextResponse.json({ error: `Unsupported type: ${contentType}` }, { status: 415 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 413 });
      }
      bytes = Buffer.from(await file.arrayBuffer());
      ext = contentType.split("/")[1] || "png";
    } else {
      // Fallback: data URL via JSON
      const body = await req.json().catch(() => ({}));
      const dataUrl = String(body?.dataUrl || "");
      const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!m) return NextResponse.json({ error: "Invalid dataUrl" }, { status: 400 });
      contentType = m[1].toLowerCase();
      if (!ALLOWED_TYPES.includes(contentType)) {
        return NextResponse.json({ error: `Unsupported type: ${contentType}` }, { status: 415 });
      }
      bytes = Buffer.from(m[2], "base64");
      if (bytes.length > MAX_BYTES) {
        return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 413 });
      }
      ext = contentType.split("/")[1] || "png";
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  // Build a stable key: user-uploads/<user_id>/<ts>-<rand>.<ext>
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${PREFIX}/${user.id}/${ts}-${rand}.${ext}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType, upsert: false, cacheControl: "31536000" });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(key);
  return NextResponse.json({ ok: true, url: pub.publicUrl, key });
}
