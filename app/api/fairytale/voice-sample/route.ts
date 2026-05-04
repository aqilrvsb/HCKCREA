import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadBuffer, signedGetUrl, head as headObject } from "@/lib/b2";
import { getStorytellingVoiceSpeed } from "@/lib/settings";

// POST /api/fairytale/voice-sample
// Body: { voice_id: "Malay_male_1_v1", language: "ms" | "en" }
//
// Returns a signed B2 URL for a ~6-second sample of the requested voice
// reading a fixed sentence. Synthesized at the admin-configured speed
// (storytelling_voice_speed) so the preview matches what the user will
// hear in the final video — no client-side playbackRate tricks needed.
// Cached on B2 keyed by voice_id + language + speed so each speed gets
// its own permanent cache. First user pays once, everyone else free.
//
// Used by the Step 1 voice picker so clients can preview each voice
// before committing. Decoupled from /api/fairytale/tts-cache so playing
// samples doesn't trigger a full N-scene script regen.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Fixed sample sentence per language. Short enough to keep MiniMax cost
// low (~12-15 words = ~6s of audio), descriptive enough to give the
// listener a real feel for the voice's tone + pacing.
const SAMPLE_TEXT: Record<"ms" | "en", string> = {
  ms: "Hai, saya akan menjadi penyampai cerita anda. Mari kita mulakan perjalanan ini bersama-sama.",
  en: "Hi there, I'll be narrating your story today. Let's begin this journey together.",
};

const SAMPLE_TTL_SEC = 60 * 60 * 24 * 7; // B2 SigV4 max lifetime

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Synthesize at admin-tuned speed so the sample sounds exactly like
  // the final video narration (no playbackRate hack needed at the
  // client). Speed becomes part of the cache key so 1.0 / 1.2 / 1.5
  // each get their own permanent cache without colliding.
  const speed = await getStorytellingVoiceSpeed();
  const speedTag = speed.toFixed(2).replace(".", "_"); // "1.20" -> "1_20"

  // Shared cache key — NO user prefix so the synthesis cost is amortized
  // across the whole platform. Once any user previews voice X at speed Y,
  // every future preview at the same speed is free.
  const b2Key = `_voice-samples/${voiceId}-${language}-${speedTag}.mp3`;

  // headObject throws on 404 — that's our cache-miss signal. Any
  // success response means the MP3 is already in B2 and we can skip the
  // MiniMax call entirely. Other errors fall through to synthesis too,
  // which is harmless (worst case we re-upload the same key).
  let needsSynthesis = false;
  try {
    await headObject({ key: b2Key });
  } catch {
    needsSynthesis = true;
  }

  if (needsSynthesis) {
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
      return NextResponse.json(
        { error: `MiniMax HTTP ${r.status}` },
        { status: 502 }
      );
    }
    const data = await r.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return NextResponse.json(
        { error: `MiniMax: ${data.base_resp.status_msg}` },
        { status: 502 }
      );
    }
    const hex: string = data?.audio_data || data?.data?.audio || "";
    if (!hex) {
      return NextResponse.json({ error: "MiniMax returned no audio" }, { status: 502 });
    }
    const bytes = Buffer.from(hex, "hex");
    await uploadBuffer({
      body: bytes,
      key: b2Key,
      contentType: "audio/mpeg",
    });
  }

  const url = await signedGetUrl({ key: b2Key, expiresInSec: SAMPLE_TTL_SEC });
  return NextResponse.json({ ok: true, url, cached: !needsSynthesis, speed });
}
