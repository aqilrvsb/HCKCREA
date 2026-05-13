import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadBufferToStoragePublic } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/attachments/transfer
// Body: { history_id: string, category: "product" | "avatar", name?: string }
//
// Takes a completed image-tab history row and copies its output_url into
// the user's Attachments library. Stores history_id in source_history_id
// so the image-tab card can show a "transferred" state and revert when
// the user deletes the attachment.
//
// Idempotent: if an attachment already exists for (user_id, history_id)
// the existing row is returned instead of creating a duplicate.

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

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const rawCat = String(body?.category || "").toLowerCase();
  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });
  if (rawCat !== "product" && rawCat !== "avatar") {
    return NextResponse.json({ error: "category must be 'product' or 'avatar'" }, { status: 400 });
  }
  const category = rawCat as "product" | "avatar";
  const providedName = typeof body?.name === "string" ? body.name.trim() : "";

  // RLS-scoped read of the history row — fails if the row isn't the user's.
  const { data: hist, error: histErr } = await sb
    .from("history")
    .select("id, type, output_url, prompt, status")
    .eq("id", historyId)
    .single();
  if (histErr || !hist) {
    return NextResponse.json({ error: "History row not found" }, { status: 404 });
  }
  if (hist.status !== "done" || !hist.output_url) {
    return NextResponse.json({ error: "History row is not complete" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency — if already transferred, return the existing row.
  const { data: existing } = await admin
    .from("attachments")
    .select("*")
    .eq("user_id", user.id)
    .eq("source_history_id", historyId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, attachment: existing, reused: true });
  }

  // Fetch the source image bytes. The output_url might be a B2 / fal / RH
  // URL — all fetchable over public HTTPS. We require image content-type.
  let fetched: Response;
  try {
    fetched = await fetch(hist.output_url);
  } catch (e: any) {
    return NextResponse.json({ error: `Source fetch failed: ${e?.message}` }, { status: 502 });
  }
  if (!fetched.ok) {
    return NextResponse.json({ error: `Source fetch HTTP ${fetched.status}` }, { status: 502 });
  }
  const contentType = (fetched.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: `Unsupported source content-type: ${contentType}` }, { status: 415 });
  }
  const buffer = Buffer.from(await fetched.arrayBuffer());

  // Mint the row first so we have an id for the B2 key.
  const defaultName =
    providedName ||
    (typeof hist.prompt === "string" && hist.prompt.trim()
      ? hist.prompt.trim().slice(0, 80)
      : `Transferred ${new Date().toISOString().slice(0, 10)}`);

  const { data: pending, error: insErr } = await admin
    .from("attachments")
    .insert({
      user_id: user.id,
      name: defaultName,
      b2_key: "",
      public_url: "",
      content_type: contentType,
      size_bytes: buffer.length,
      category,
      source_history_id: historyId,
    })
    .select("id")
    .single();
  if (insErr || !pending) {
    return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  }

  const key = `attachments/${user.id}/${pending.id}.${extFor(contentType)}`;
  let publicUrl = "";
  try {
    const r = await uploadBufferToStoragePublic({ body: buffer, key, contentType });
    publicUrl = r.publicUrl;
  } catch (e: any) {
    await admin.from("attachments").delete().eq("id", pending.id);
    return NextResponse.json({ error: "B2 upload failed", detail: e?.message }, { status: 502 });
  }

  const { data: row } = await admin
    .from("attachments")
    .update({ b2_key: key, public_url: publicUrl })
    .eq("id", pending.id)
    .select("*")
    .single();

  return NextResponse.json({ ok: true, attachment: row });
}
