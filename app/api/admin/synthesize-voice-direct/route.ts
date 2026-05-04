import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorytellingVoiceSpeed } from "@/lib/settings";

// POST /api/admin/synthesize-voice-direct
// Body: { voice_id: string, language: "ms" | "en" }
//
// One-shot bake helper: synthesizes a voice sample via MiniMax at the
// admin-configured speed and returns the raw MP3 bytes inline (NOT
// uploaded to B2). Used to download samples locally and commit them
// to /public/voice-samples/ — eliminates the B2 daily download cap
// dependency that broke sample playback when the cap was exhausted.
//
// Admin-only. After committing the baked files into /public, this
// route can be removed.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const SAMPLE_TEXT: Record<"ms" | "en", string> = {
  ms: "Hai, saya akan menjadi penyampai cerita anda. Mari kita mulakan perjalanan ini bersama-sama.",
  en: "Hi there, I'll be narrating your story today. Let's begin this journey together.",
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin gate — only admins can fire this (it costs MiniMax API).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "MINIMAX_API_KEY not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const voiceId = String(body?.voice_id || "").trim();
  const language: "ms" | "en" = body?.language === "en" ? "en" : "ms";
  if (!voiceId) {
    return NextResponse.json({ error: "voice_id required" }, { status: 400 });
  }

  const speed = await getStorytellingVoiceSpeed();
  const text = SAMPLE_TEXT[language];

  const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-2.6-turbo",
      text,
      stream: false,
      language_boost: language === "en" ? "English" : "Malay",
      output_format: "hex",
      voice_setting: { voice_id: voiceId, speed, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
    }),
  });
  if (!r.ok) {
    return NextResponse.json({ error: `MiniMax HTTP ${r.status}` }, { status: 502 });
  }
  const data = await r.json();
  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    return NextResponse.json({ error: `MiniMax: ${data.base_resp.status_msg}` }, { status: 502 });
  }
  const hex: string = data?.audio_data || data?.data?.audio || "";
  if (!hex) {
    return NextResponse.json({ error: "MiniMax returned no audio" }, { status: 502 });
  }
  const bytes = Buffer.from(hex, "hex");

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(bytes.length),
      "X-Voice-Speed": String(speed),
    },
  });
}
