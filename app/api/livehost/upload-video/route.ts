import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadBufferToStoragePublic } from "@/lib/b2";

// POST /api/livehost/upload-video — multipart { file } (an .mp4 motion
// reference for the Template Body / Kling tab). Rehosts to public B2 and
// returns { url }. MP4 only, capped at MAX_BYTES.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

  const isMp4 = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
  if (!isMp4) return NextResponse.json({ error: "Hanya video MP4 dibenarkan." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Video terlalu besar (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = `livehost-motion/${user.id}/${crypto.randomUUID()}.mp4`;
  try {
    const { publicUrl } = await uploadBufferToStoragePublic({ body: buf, key, contentType: "video/mp4" });
    return NextResponse.json({ ok: true, url: publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 });
  }
}
