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
    .select("id, title, text, voice_id, volume, speed, emotion, chars, audio_path, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const scripts = [];
  for (const s of data || []) {
    let audioUrl: string | null = null;
    if (s.audio_path) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(s.audio_path, SIGN_TTL);
      audioUrl = signed?.signedUrl || null;
    }
    scripts.push({
      id: s.id, title: s.title, text: s.text,
      voiceId: s.voice_id, volume: s.volume, speed: s.speed, emotion: s.emotion,
      chars: s.chars, audioUrl, createdAt: s.created_at,
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
  // Preferred: audio_path = a draft already uploaded by /script-generate (no
  // base64 round-trip → any length works). Legacy: audio_b64 inline upload.
  const audioPath = String(b?.audio_path || "");
  const audioB64 = String(b?.audio_b64 || "");
  if (!text || (!audioPath && !audioB64)) return NextResponse.json({ error: "text and audio required" }, { status: 400 });

  const { data: row, error: insErr } = await admin
    .from("livehost_scripts")
    .insert({ user_id: user.id, title, text, voice_id: voiceId, volume, speed, emotion, chars })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const path = `${user.id}/${row.id}.wav`;
  if (audioPath) {
    // move the draft into the script's stable path (guard: must be the caller's own draft)
    if (!audioPath.startsWith(`${user.id}/`)) {
      await admin.from("livehost_scripts").delete().eq("id", row.id);
      return NextResponse.json({ error: "invalid audio_path" }, { status: 400 });
    }
    const { error: mvErr } = await admin.storage.from(BUCKET).move(audioPath, path);
    if (mvErr) {
      await admin.from("livehost_scripts").delete().eq("id", row.id);
      return NextResponse.json({ error: mvErr.message }, { status: 500 });
    }
  } else {
    const bytes = Buffer.from(audioB64, "base64");
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: "audio/wav",
      upsert: true,
    });
    if (upErr) {
      await admin.from("livehost_scripts").delete().eq("id", row.id);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }
  await admin.from("livehost_scripts").update({ audio_path: path }).eq("id", row.id);
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
  return NextResponse.json({ ok: true, id: row.id, audioUrl: signed?.signedUrl || null });
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
    .select("audio_path")
    .eq("id", id).eq("user_id", user.id)
    .maybeSingle();
  if (row?.audio_path) await admin.storage.from(BUCKET).remove([row.audio_path]);
  await admin.from("livehost_scripts").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
