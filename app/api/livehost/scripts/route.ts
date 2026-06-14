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
  const audioB64 = String(b?.audio_b64 || "");
  if (!text || !audioB64) return NextResponse.json({ error: "text and audio_b64 required" }, { status: 400 });

  const { data: row, error: insErr } = await admin
    .from("livehost_scripts")
    .insert({ user_id: user.id, title, text, voice_id: voiceId, volume, speed, emotion, chars })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const path = `${user.id}/${row.id}.wav`;
  const bytes = Buffer.from(audioB64, "base64");
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "audio/wav",
    upsert: true,
  });
  if (upErr) {
    await admin.from("livehost_scripts").delete().eq("id", row.id);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  await admin.from("livehost_scripts").update({ audio_path: path }).eq("id", row.id);
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
  return NextResponse.json({ ok: true, id: row.id, audioUrl: signed?.signedUrl || null });
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
