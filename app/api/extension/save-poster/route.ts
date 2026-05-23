import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authExtensionUser } from "@/lib/extension-auth";
import { uploadBufferToContent, buildKey } from "@/lib/b2";

// POST /api/extension/save-poster
//
// Self-healing poster backfill. The first client (dashboard or
// extension) that views a video and successfully captures its first
// frame uploads that JPG here. Server rehosts to B2 + stamps
// metadata.poster_url so every subsequent viewer on any surface gets
// the cheap <img> fast path instead of having to capture again.
//
// Auth via authExtensionUser which accepts:
//   • x-pl-email header (extension)
//   • Authorization: Bearer <token>
//   • Supabase session cookies (dashboard)
//
// Body: { history_id: string, poster_data_url: string }
//   poster_data_url is a "data:image/jpeg;base64,..." string from
//   canvas.toDataURL("image/jpeg", 0.78).
//
// Idempotent — silently skips when the row already has poster_url
// (last-write-wins is fine since every client produces the same JPG).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Max accepted payload — 500 KB of base64 covers JPG quality 0.78 at
// 720×1280 with headroom. Larger requests are almost certainly
// malicious or buggy.
const MAX_DATA_URL_LEN = 700_000;

export async function POST(req: Request) {
  const user = await authExtensionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const dataUrl = String(body?.poster_data_url || "");
  if (!historyId) {
    return NextResponse.json({ error: "history_id required" }, { status: 400 });
  }
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
    return NextResponse.json(
      { error: "poster_data_url must be a data:image/jpeg;base64 string" },
      { status: 400 }
    );
  }
  if (dataUrl.length > MAX_DATA_URL_LEN) {
    return NextResponse.json(
      { error: `Payload too large (${dataUrl.length} bytes, max ${MAX_DATA_URL_LEN})` },
      { status: 413 }
    );
  }

  const admin = createAdminClient();

  // Verify the row belongs to the caller. Also skip the upload work
  // if the row already has a poster_url so multiple clients don't
  // race to overwrite each other (last-write-wins is safe but
  // wastes bandwidth + B2 PUT quota).
  const { data: row, error: fetchErr } = await admin
    .from("history")
    .select("id, user_id, type, status, metadata")
    .eq("id", historyId)
    .maybeSingle();
  if (fetchErr || !row) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.status !== "done") {
    return NextResponse.json(
      { error: "Row not finished yet" },
      { status: 409 }
    );
  }
  const existingMeta = (row.metadata as Record<string, any>) || {};
  if (existingMeta.poster_url) {
    // Already populated — skip the upload. Tells the client "you
    // don't need to upload again, we have it" so the client can
    // mark the row locally and stop attempting on subsequent loads.
    return NextResponse.json({
      ok: true,
      already_have_poster: true,
      poster_url: existingMeta.poster_url,
    });
  }

  // Decode the base64 JPG.
  const base64 = dataUrl.substring("data:image/jpeg;base64,".length);
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch (e: any) {
    return NextResponse.json(
      { error: "Invalid base64: " + (e?.message || "decode failed") },
      { status: 400 }
    );
  }
  if (buf.length < 1000) {
    return NextResponse.json(
      { error: `Decoded buffer too small (${buf.length} bytes)` },
      { status: 400 }
    );
  }

  // Match the storage type the video already uses so the poster key
  // sits next to the video file in B2 (e.g.
  //   users/<uid>/auto/<id>.mp4
  //   users/<uid>/auto/<id>-poster.jpg
  // ).
  let sType: "ugc" | "auto" | "cinema" = "ugc";
  if (row.type === "auto-content") sType = "auto";
  else if (row.type === "cinema") sType = "cinema";
  const videoKey = buildKey({
    userId: user.id,
    type: sType,
    historyId: row.id,
    ext: "mp4",
  });
  const posterKey = videoKey.replace(/\.mp4$/i, "-poster.jpg");

  try {
    const { publicUrl } = await uploadBufferToContent({
      body: buf,
      key: posterKey,
      contentType: "image/jpeg",
    });

    await admin
      .from("history")
      .update({ metadata: { ...existingMeta, poster_url: publicUrl } })
      .eq("id", row.id);

    return NextResponse.json({ ok: true, poster_url: publicUrl });
  } catch (e: any) {
    return NextResponse.json(
      { error: "B2 upload failed: " + (e?.message || "unknown") },
      { status: 502 }
    );
  }
}
