// MiniMax text-to-speech, shared by the public /api/tts endpoint and the
// Motion tab (per-line voice-over). Uses OUR server-side MINIMAX_API_KEY and
// hosts the MP3 on the public content bucket.

import { randomUUID } from "node:crypto";
import { uploadBufferToContent } from "@/lib/b2";

// Named voices → MiniMax voice_id (mirrors app/dashboard/livehost-studio.tsx).
export const TTS_VOICES: Record<string, string> = {
  mira: "moss_audio_cf82d8cb-4799-11f1-aea0-d66da573c477",
  jamal: "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b",
  afifah: "moss_audio_b4d54c5a-225f-11f1-bf6e-065823da7bf2",
  aqil: "Malay_male_1_v1",
  nana: "Malay_female_1_v1",
  mila: "Malay_female_2_v1",
};
export const TTS_EMOTIONS = ["fluent", "happy", "neutral", "surprised", "sad", "angry", "fearful", "disgusted", "calm"];
export const TTS_MAX_CHARS = 5000;

export function resolveVoice(input: string): string {
  const v = (input || "").trim();
  if (!v) return TTS_VOICES.mira;
  // Raw MiniMax id (cloned "moss_audio_*" or preset "Malay_*") → use as-is.
  if (/^moss_audio_/i.test(v) || /^[A-Za-z]+_(male|female)_\d/i.test(v)) return v;
  return TTS_VOICES[v.toLowerCase()] || TTS_VOICES.mira;
}

export type TtsResult =
  | { ok: true; audioUrl: string; durationSec: number | null; chars: number; voice: string }
  | { ok: false; error: string };

export async function synthesizeSpeech(opts: {
  text: string;
  voice?: string;
  emotion?: string;
  speed?: number;
  language?: "ms" | "en";
  /** B2 key prefix; default "tts". */
  keyPrefix?: string;
}): Promise<TtsResult> {
  const apiKey = (process.env.MINIMAX_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "MINIMAX_API_KEY not configured" };
  const text = String(opts.text || "").trim().slice(0, TTS_MAX_CHARS);
  if (!text) return { ok: false, error: "text required" };
  const voiceId = resolveVoice(String(opts.voice || ""));
  const emRaw = String(opts.emotion || "fluent").toLowerCase();
  const emotion = TTS_EMOTIONS.includes(emRaw) ? emRaw : "fluent";
  const speed = Math.max(0.5, Math.min(2.0, Number(opts.speed) || 1.0));
  const language = opts.language === "en" ? "en" : "ms";

  try {
    const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "speech-2.6-turbo",
        text,
        stream: false,
        language_boost: language === "en" ? "English" : "Malay",
        output_format: "hex",
        voice_setting: { voice_id: voiceId, speed, vol: 1.5, pitch: 0, emotion },
        audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, error: `MiniMax HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const data = await r.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return { ok: false, error: `MiniMax: ${data.base_resp.status_msg}` };
    }
    const hex: string = data?.data?.audio || data?.audio_data || "";
    if (!hex) return { ok: false, error: "MiniMax returned no audio" };
    const bytes = Buffer.from(hex, "hex");

    // Duration — MiniMax returns audio_length (ms) in extra_info when available.
    const lenMs = Number(data?.extra_info?.audio_length);
    const durationSec = Number.isFinite(lenMs) && lenMs > 0 ? Number((lenMs / 1000).toFixed(2)) : null;

    const key = `${opts.keyPrefix || "tts"}/${randomUUID()}.mp3`;
    const { publicUrl } = await uploadBufferToContent({ body: bytes, key, contentType: "audio/mpeg" });
    return { ok: true, audioUrl: publicUrl, durationSec, chars: text.length, voice: voiceId };
  } catch (e: any) {
    return { ok: false, error: e?.message || "TTS error" };
  }
}
