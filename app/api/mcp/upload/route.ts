import { NextResponse } from "next/server";
import { validateMcpKey, validateMcpKeyString } from "@/lib/mcp-auth";
import { uploadBufferToStoragePublic } from "@/lib/b2";
import crypto from "crypto";

// POST /api/mcp/upload — turn a client image into a public https URL that
// the video/image generators can actually fetch.
//
// Why: /api/mcp/generate/* require image_urls to be PUBLIC https URLs the
// server (and the upstream provider) can download. A ChatGPT-uploaded file,
// a base64 blob, or a hotlink-protected/region-blocked link won't work. So
// the GPT should upload first → get a guaranteed-fetchable URL → pass THAT
// in image_urls.
//
// Accepts EITHER:
//   { api_key, image_url }     — we fetch + rehost the URL to our storage
//   { api_key, image_base64 }  — data URL or raw base64
// Returns: { ok, url }
//
// Auth: api_key in body OR Authorization: Bearer header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const bodyKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  const auth = bodyKey ? await validateMcpKeyString(bodyKey) : await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let buf: Buffer | null = null;
  let contentType = "image/png";

  const imageUrl = typeof body?.image_url === "string" ? body.image_url.trim() : "";
  const imageB64 = typeof body?.image_base64 === "string" ? body.image_base64.trim() : "";

  if (imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "image_url must be http(s)" }, { status: 400 });
    }
    let r: Response;
    try {
      r = await fetch(imageUrl, { signal: AbortSignal.timeout(25_000) });
    } catch (e: any) {
      return NextResponse.json({ error: `Source fetch failed: ${e?.message || e}` }, { status: 502 });
    }
    if (!r.ok) {
      return NextResponse.json({ error: `Source fetch HTTP ${r.status}` }, { status: 502 });
    }
    contentType = (r.headers.get("content-type") || "image/png").split(";")[0].trim();
    buf = Buffer.from(await r.arrayBuffer());
  } else if (imageB64) {
    const m = imageB64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    const b64 = m ? m[2] : imageB64;
    if (m) contentType = m[1];
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Provide image_url or image_base64" }, { status: 400 });
  }

  if (!buf || buf.length === 0) {
    return NextResponse.json({ error: "Empty image" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 15MB)" }, { status: 413 });
  }
  if (!contentType.startsWith("image/")) contentType = "image/png";

  const ext = EXT[contentType] || "png";
  const key = `mcp-uploads/${auth.userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

  try {
    const { publicUrl } = await uploadBufferToStoragePublic({ body: buf, key, contentType });
    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: `Upload failed: ${e?.message || e}` }, { status: 500 });
  }
}
