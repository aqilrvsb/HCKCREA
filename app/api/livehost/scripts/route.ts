import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// /api/livehost/scripts — the saved script library (history).
// A saved script bundles: text + per-script voice settings (voice/volume/speed/
// emotion) + the pre-generated audio (mp3 in the 'livehost-audio' bucket).
// GET    → list the user's scripts with fresh signed audio URLs
// POST   → save: upload the generated audio + insert the row
// DELETE → ?id= : remove the row + its audio file

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const BUCKET = "livehost-audio";
const SIGN_TTL = 60 * 60 * 6; // 6h

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("livehost_scripts")
    .select("id, title, text, voice_id, volume, speed, emotion, chars, audio_path, audio_paths, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const scripts = [];
  for (const s of data || []) {
    // Ordered playback pieces. New scripts store audio_paths[]; older single-file
    // scripts fall back to the lone audio_path so they still play.
    const paths: string[] = Array.isArray(s.audio_paths) && s.audio_paths.length
      ? (s.audio_paths as string[])
      : (s.audio_path ? [s.audio_path] : []);
    const audioUrls: string[] = [];
    for (const p of paths) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(p, SIGN_TTL);
      if (signed?.signedUrl) audioUrls.push(signed.signedUrl);
    }
    scripts.push({
      id: s.id, title: s.title, text: s.text,
      voiceId: s.voice_id, volume: s.volume, speed: s.speed, emotion: s.emotion,
      chars: s.chars, audioUrls, audioUrl: audioUrls[0] || null, createdAt: s.created_at,
    });
  }
  return NextResponse.json({ scripts });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();

  const b = await req.json().catch(() => ({}));
  const title = String(b?.title || "Script").slice(0, 200);
  const text = String(b?.text || "");
  const voiceId = String(b?.voice_id || "");
  const volume = Number(b?.volume) || 1.5;
  const speed = Number(b?.speed) || 1.0;
  const emotion = String(b?.emotion || "fluent");
  const chars = Number(b?.chars) || text.length;
  // Ordered list of draft pieces uploaded by /script-generate. Chunked playback
  // only — each piece is moved into the script's stable path and stored in order.
  const draftPaths: string[] = Array.isArray(b?.audio_paths) ? b.audio_paths.map(String) : [];
  if (!text || !draftPaths.length) return NextResponse.json({ error: "text and audio required" }, { status: 400 });
  if (!draftPaths.every((p) => p.startsWith(`${user.id}/`))) {
    return NextResponse.json({ error: "invalid audio_paths" }, { status: 400 });
  }

  const { data: row, error: insErr } = await admin
    .from("livehost_scripts")
    .insert({ user_id: user.id, title, text, voice_id: voiceId, volume, speed, emotion, chars })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const finalPaths: string[] = [];
  for (let i = 0; i < draftPaths.length; i++) {
    const dst = `${user.id}/${row.id}-${String(i).padStart(3, "0")}.wav`;
    const { error: mvErr } = await admin.storage.from(BUCKET).move(draftPaths[i], dst);
    if (mvErr) {
      if (finalPaths.length) await admin.storage.from(BUCKET).remove(finalPaths);
      await admin.from("livehost_scripts").delete().eq("id", row.id);
      return NextResponse.json({ error: mvErr.message }, { status: 500 });
    }
    finalPaths.push(dst);
  }
  await admin.from("livehost_scripts").update({ audio_paths: finalPaths, audio_path: finalPaths[0] }).eq("id", row.id);

  const audioUrls: string[] = [];
  for (const p of finalPaths) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(p, SIGN_TTL);
    if (signed?.signedUrl) audioUrls.push(signed.signedUrl);
  }
  return NextResponse.json({ ok: true, id: row.id, audioUrls, audioUrl: audioUrls[0] || null });
}

// PATCH → update fields of an existing saved script (e.g. auto-save the title
// as the user types) WITHOUT touching the audio. Body: { id, title?, text?,
// voice_id?, volume?, speed?, emotion? }.
export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  const b = await req.json().catch(() => ({}));
  const id = String(b?.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b.title === "string") patch.title = b.title.slice(0, 200);
  if (typeof b.text === "string") { patch.text = b.text; patch.chars = b.text.length; }
  if (typeof b.voice_id === "string") patch.voice_id = b.voice_id;
  if (b.volume != null) patch.volume = Number(b.volume);
  if (b.speed != null) patch.speed = Number(b.speed);
  if (typeof b.emotion === "string") patch.emotion = b.emotion;
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  const { error } = await admin
    .from("livehost_scripts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { data: row } = await admin
    .from("livehost_scripts")
    .select("audio_path, audio_paths")
    .eq("id", id).eq("user_id", user.id)
    .maybeSingle();
  const toRemove = [
    ...(Array.isArray(row?.audio_paths) ? (row!.audio_paths as string[]) : []),
    ...(row?.audio_path ? [row.audio_path] : []),
  ];
  if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove);
  await admin.from("livehost_scripts").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
