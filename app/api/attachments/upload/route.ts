import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadBufferToStoragePublic } from "@/lib/b2";
import { compressImageIfNeeded } from "@/lib/compress-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/attachments/upload
// Accepts multipart/form-data with field 'file' (Blob) and optional 'name'.
// Uploads to peninglab-storage at attachments/{user_id}/{id}.{ext} and
// inserts a row in public.attachments. Returns the row JSON.
//
// RLS: insert uses the service-role admin client; user_id stamped from
// the verified session. Reads later go through the user client + RLS.

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB before compression
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function extFor(ct: string): string {
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "jpg";
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  let file: File;
  let providedName: string;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!f || !(f instanceof Blob)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(f.type || "")) {
      return NextResponse.json(
        { error: `Unsupported type: ${f.type}` },
        { status: 415 }
      );
    }
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 413 });
    }
    file = f as File;
    providedName = String(form.get("name") || "").trim();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Read failed" }, { status: 400 });
  }

  // Compress if > 4 MB so the B2 PUT stays inside Vercel's body limit.
  const compressed = await compressImageIfNeeded(file);
  const finalFile = compressed.file;
  const finalCt = finalFile.type || file.type || "image/jpeg";
  const buffer = Buffer.from(await finalFile.arrayBuffer());

  const admin = createAdminClient();

  // Insert first to mint an id, then key the upload to that id.
  const defaultName = providedName || file.name || `Attachment ${new Date().toISOString().slice(0, 10)}`;
  const { data: pending, error: insErr } = await admin
    .from("attachments")
    .insert({
      user_id: user.id,
      name: defaultName,
      b2_key: "",            // filled in after upload
      public_url: "",
      content_type: finalCt,
      size_bytes: buffer.length,
    })
    .select("id")
    .single();

  if (insErr || !pending) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const ext = extFor(finalCt);
  const key = `attachments/${user.id}/${pending.id}.${ext}`;

  let publicUrl = "";
  try {
    const r = await uploadBufferToStoragePublic({
      body: buffer,
      key,
      contentType: finalCt,
    });
    publicUrl = r.publicUrl;
  } catch (e: any) {
    // Clean up the orphan row so the user doesn't see a broken card.
    await admin.from("attachments").delete().eq("id", pending.id);
    return NextResponse.json(
      { error: "B2 upload failed", detail: e?.message },
      { status: 502 }
    );
  }

  const { data: row, error: updErr } = await admin
    .from("attachments")
    .update({ b2_key: key, public_url: publicUrl })
    .eq("id", pending.id)
    .select("*")
    .single();

  if (updErr || !row) {
    return NextResponse.json(
      { error: "DB update failed", detail: updErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, attachment: row });
}
