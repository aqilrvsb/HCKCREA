import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadBufferToContent } from "@/lib/b2";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extend/upload-frame
// Accepts a multipart/form-data file (PNG produced client-side by canvas)
// and uploads it to peninglab-storage at extend-frames/{user_id}/{uuid}.png.
// Returns the direct public S3 URL.
//
// Distinct from /api/attachments/upload: no DB row, no "Attachments" library
// entry. Frame extracts are pipeline artifacts so we send them to the
// peninglab-content bucket (30-day B2 lifecycle cleanup) instead of
// peninglab-storage (permanent). Keeps long-term storage cost flat.
//
// Frame is captured at the source video's full resolution (videoWidth ×
// videoHeight) in the browser — no fal.ai compression, no downscale,
// no third-party API in the loop.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — plenty for a 1080p PNG frame
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!f || !(f instanceof Blob)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    if (!ALLOWED.has(f.type || "")) {
      return NextResponse.json({ error: `Unsupported type: ${f.type}` }, { status: 415 });
    }
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: "Frame too large (max 20MB)" }, { status: 413 });
    }
    file = f as File;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  const ext =
    file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const key = `extend-frames/${user.id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const r = await uploadBufferToContent({
      body: buffer,
      key,
      contentType: file.type,
    });
    return NextResponse.json({ ok: true, url: r.publicUrl, size: r.size });
  } catch (e: any) {
    return NextResponse.json(
      { error: "B2 upload failed", detail: e?.message },
      { status: 502 }
    );
  }
}
