import { NextResponse } from "next/server";
import { validateMcpKey, validateMcpKeyString } from "@/lib/mcp-auth";
import { uploadBufferToStoragePublic } from "@/lib/b2";
import crypto from "crypto";

// POST /api/mcp/upload — turn a client image into a permanent public https
// URL that the video/image generators can actually fetch.
//
// Why: /api/mcp/generate/* require image_urls to be PUBLIC https URLs the
// server (and the upstream provider) can download. A ChatGPT-uploaded file,
// a base64 blob, or a hotlink-protected/region-blocked link won't work.
//
// Accepts (in priority order):
//   { openaiFileIdRefs: [{ download_link }, ...] }  — the NATIVE Custom-GPT
//        path. ChatGPT injects a 5-minute public download_link for each
//        image the user uploaded OR the GPT generated (e.g. a storyboard).
//        We fetch it within those 5 min and rehost to permanent storage.
//        Zero-touch: no pasting, native quality kept.
//   { image_url }     — rehost an existing public link
//   { image_base64 }  — data URL / raw base64 (server-to-server clients)
// Returns: { ok, url, urls } — url = first, urls = all uploaded.
//
// Auth: api_key in body OR Authorization: Bearer header.

const MAX_REFS = 4;

async function fetchToBuffer(u: string): Promise<{ buf: Buffer; contentType: string }> {
  const r = await fetch(u, { signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`source fetch HTTP ${r.status}`);
  const contentType = (r.headers.get("content-type") || "image/png").split(";")[0].trim();
  return { buf: Buffer.from(await r.arrayBuffer()), contentType };
}

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

  // Collect source items → each becomes { buf, contentType }.
  const sources: { buf: Buffer; contentType: string }[] = [];

  // 1) openaiFileIdRefs — native Custom-GPT file passing. ChatGPT injects
  //    [{ name, id, mime_type, download_link }]. Fetch each download_link.
  const refs = Array.isArray(body?.openaiFileIdRefs) ? body.openaiFileIdRefs.slice(0, MAX_REFS) : [];
  for (const ref of refs) {
    const link =
      typeof ref === "string"
        ? ref
        : (ref && typeof ref.download_link === "string" ? ref.download_link : "");
    if (!link || !/^https?:\/\//i.test(link)) continue;
    try {
      sources.push(await fetchToBuffer(link));
    } catch (e: any) {
      return NextResponse.json({ error: `openaiFileIdRefs fetch failed: ${e?.message || e}` }, { status: 502 });
    }
  }

  // 2) image_url — rehost an existing public link.
  const imageUrl = typeof body?.image_url === "string" ? body.image_url.trim() : "";
  if (imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "image_url must be http(s)" }, { status: 400 });
    }
    try {
      sources.push(await fetchToBuffer(imageUrl));
    } catch (e: any) {
      return NextResponse.json({ error: `Source fetch failed: ${e?.message || e}` }, { status: 502 });
    }
  }

  // 3) image_base64 — for server-to-server clients holding the bytes.
  const imageB64 = typeof body?.image_base64 === "string" ? body.image_base64.trim() : "";
  if (imageB64) {
    const m = imageB64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    const b64 = m ? m[2] : imageB64;
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64" }, { status: 400 });
    }
    sources.push({ buf, contentType: m ? m[1] : "image/png" });
  }

  if (sources.length === 0) {
    return NextResponse.json(
      { error: "Provide openaiFileIdRefs, image_url, or image_base64" },
      { status: 400 }
    );
  }

  const urls: string[] = [];
  for (const { buf, contentType: ctRaw } of sources) {
    if (!buf || buf.length === 0) continue;
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large (max 15MB)" }, { status: 413 });
    }
    const contentType = ctRaw.startsWith("image/") ? ctRaw : "image/png";
    const ext = EXT[contentType] || "png";
    const key = `mcp-uploads/${auth.userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    try {
      const { publicUrl } = await uploadBufferToStoragePublic({ body: buf, key, contentType });
      urls.push(publicUrl);
    } catch (e: any) {
      return NextResponse.json({ error: `Upload failed: ${e?.message || e}` }, { status: 500 });
    }
  }

  if (urls.length === 0) {
    return NextResponse.json({ error: "Empty image" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, url: urls[0], urls });
}
