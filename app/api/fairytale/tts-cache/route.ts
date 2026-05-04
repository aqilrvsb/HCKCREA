import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadBuffer, signedGetUrl } from "@/lib/b2";

// POST /api/fairytale/tts-cache
// Body: {
//   history_id: uuid,
//   voice_id: "Malay_BellaSoothing",
//   speed: 1.0,
//   scenes: [{ idx: 0, narration: "..." }, ...]
// }
//
// For each scene: call MiniMax t2a_v2 → upload mp3 to B2 at
// users/{user}/_fairytale-tts-cache/{history_id}-scene-{idx}.mp3 → return
// presigned GET URL. The frontend caches these for live preview AND sends
// them back in the merge payload so Modal can skip TTS regeneration.

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

async function _ttsToB2(opts: {
  text: string;
  voiceId: string;
  speed: number;
  language: "ms" | "en";
  apiKey: string;
  b2Key: string;
}): Promise<{ url: string; size: number }> {
  // 1. MiniMax TTS → hex
  const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-2.6-turbo",
      text: opts.text,
      stream: false,
      language_boost: opts.language === "en" ? "English" : "Malay",
      output_format: "hex",
      voice_setting: { voice_id: opts.voiceId, speed: opts.speed, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
    }),
  });
  if (!r.ok) {
    throw new Error(`MiniMax HTTP ${r.status}`);
  }
  const data = await r.json();
  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax: ${data.base_resp.status_msg}`);
  }
  const hex: string = data?.audio_data || data?.data?.audio || "";
  if (!hex) throw new Error("MiniMax returned no audio");
  const bytes = Buffer.from(hex, "hex");

  // 2. Upload bytes directly to B2.
  const res = await uploadBuffer({
    body: bytes,
    key: opts.b2Key,
    contentType: "audio/mpeg",
  });
  return { url: "", size: res.size };
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "MINIMAX_API_KEY not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const historyId = String(body?.history_id || "").trim();
  const voiceId = String(body?.voice_id || "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b");
  const language: "ms" | "en" = body?.language === "en" ? "en" : "ms";
  // Always synthesize at natural speed (1.0). User-controlled speed is
  // applied client-side via <audio>.playbackRate AND server-side via
  // ffmpeg atempo in Modal — never via the TTS API. That keeps the
  // cached MP3 reusable across speed changes (no extra MiniMax cost).
  const speed = 1.0;
  const scenes: Array<{ idx: number; narration: string }> = Array.isArray(body?.scenes) ? body.scenes : [];

  if (!historyId) return NextResponse.json({ error: "history_id required" }, { status: 400 });
  if (scenes.length === 0) return NextResponse.json({ error: "scenes[] required" }, { status: 400 });
  if (scenes.length > 20) return NextResponse.json({ error: "max 20 scenes per call" }, { status: 400 });

  // Parallelize — MiniMax t2a_v2 handles concurrent requests fine on the
  // standard paid tier. 10 scenes finish in ~5-8s instead of 30s.
  const results = await Promise.all(scenes.map(async (s) => {
    const text = String(s.narration || "").trim().slice(0, 500);
    if (!text) return { idx: s.idx, audio_url: "", size_bytes: 0, error: "empty narration" };
    const b2Key = `users/${user.id}/_fairytale-tts-cache/${historyId}-scene-${s.idx}.mp3`;
    try {
      const { size } = await _ttsToB2({ text, voiceId, speed, language, apiKey, b2Key });
      // Max SigV4 presigned URL lifetime is 7 days (B2 enforces the AWS limit).
      // Plenty for live preview — the cache file gets re-fetched if the user
      // returns to the wizard later.
      const url = await signedGetUrl({ key: b2Key, expiresInSec: 60 * 60 * 24 * 7 });
      return { idx: s.idx, audio_url: url, size_bytes: size };
    } catch (e: any) {
      return { idx: s.idx, audio_url: "", size_bytes: 0, error: e?.message?.slice(0, 200) || "tts failed" };
    }
  }));

  const failed = results.filter((r) => !r.audio_url).length;
  return NextResponse.json({
    ok: failed === 0,
    history_id: historyId,
    results,
    failed_count: failed,
  });
}
