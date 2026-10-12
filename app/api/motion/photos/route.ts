import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// /api/motion/photos — the signed-in client's product photo gallery (Edit
// Video). Photos are uploaded browser → Modal → B2 (motion-images/<user>/…)
// and remembered here so they can be reused on the next video or deleted.
//   GET                  → { photos: [{ id, url, created_at }] }  newest first
//   POST   { url }       → remember an uploaded photo (own folder only)
//   DELETE ?id=…         → forget a photo
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PHOTOS = 60;

const ownPhotoUrl = (userId: string, url: string) => {
  const uid = userId.replace(/[^A-Za-z0-9_-]/g, "");
  return new RegExp(`^https://peninglab-content\\.s3\\.[a-z0-9-]+\\.backblazeb2\\.com/motion-images/${uid}/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$`).test(url);
};

async function signedIn() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient()
    .from("motion_photos").select("id, url, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(MAX_PHOTOS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ photos: data ?? [] });
}

export async function POST(req: Request) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const url = String(b?.url ?? "").trim();
  if (!ownPhotoUrl(user.id, url)) return NextResponse.json({ error: "Gambar tidak sah." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("motion_photos").upsert({ user_id: user.id, url }, { onConflict: "user_id,url" })
    .select("id, url, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // keep the gallery bounded: drop the oldest beyond MAX_PHOTOS
  const { data: old } = await admin.from("motion_photos").select("id")
    .eq("user_id", user.id).order("created_at", { ascending: false }).range(MAX_PHOTOS, MAX_PHOTOS + 50);
  if (old?.length) await admin.from("motion_photos").delete().in("id", old.map((r) => r.id));
  return NextResponse.json({ ok: true, photo: data });
}

export async function DELETE(req: Request) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await createAdminClient().from("motion_photos").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
