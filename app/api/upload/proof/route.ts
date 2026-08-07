import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { buildKey, uploadBufferToContent } from "@/lib/b2";

// POST /api/upload/proof  (multipart 'file') → { url }
// Payment-proof upload for the manual Touch 'n Go flows (top-up + subscribe).
// Unlike /api/upload/image (which forwards to RunningHub, images only), this
// stores straight to our public B2 bucket so it accepts BOTH images AND PDF
// receipts. Returns a stable public URL saved as metadata.proof_url.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  let buf: Buffer;
  let contentType: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) return NextResponse.json({ error: "No file" }, { status: 400 });
    contentType = file.type || "application/octet-stream";
    if (!ALLOWED.includes(contentType)) {
      return NextResponse.json({ error: `Jenis fail tak disokong: ${contentType}. Guna gambar atau PDF.` }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Fail terlalu besar (max 15MB)." }, { status: 413 });
    }
    buf = Buffer.from(await file.arrayBuffer());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  const ext = contentType === "application/pdf" ? "pdf" : (contentType.split("/")[1] || "png");
  const key = buildKey({ userId: user.id, type: "image", historyId: `proof-${randomUUID()}`, ext });

  try {
    const { publicUrl } = await uploadBufferToContent({ body: buf, key, contentType });
    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload gagal" }, { status: 502 });
  }
}
