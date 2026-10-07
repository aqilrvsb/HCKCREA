import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { uploadBufferToContent } from "@/lib/b2";

// POST /api/tts — simple Text-to-Speech API for EXTERNAL callers (e.g. another
// AI/agent). The caller just sends a script; we synthesize it via MiniMax using
// OUR server-side key (never exposed) and return a hosted MP3 URL + duration.
//
// Auth: OPTIONAL. If TTS_API_KEY is set in env, callers must send
//   `Authorization: Bearer <TTS_API_KEY>`. If TTS_API_KEY is NOT set, the
//   endpoint is OPEN (no token needed) — convenient, but anyone who knows the
//   URL can spend your MiniMax quota, so set TTS_API_KEY to lock it down.
//   Either way the MiniMax key (MINIMAX_API_KEY) stays private server-side —
//   callers never see it.
//
// Body (JSON):
//   text      string   REQUIRED — the script to speak (≤ 5000 chars)
//   voice     string   optional — label ("Mira","Jamal",…) OR a raw MiniMax
//                       voice_id. Default "Mira".
//   emotion   string   optional — fluent|happy|neutral|surprised|sad|angry|
//                       fearful|disgusted|calm. Default "fluent".
//   speed     number   optional — 0.5–2.0. Default 1.0.
//   language  "ms"|"en" optional — language boost. Default "ms".
//
// Response: { ok, audio_url, duration_sec, chars, voice }

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Named voices → MiniMax voice_id (mirrors app/dashboard/livehost-studio.tsx).
const VOICE_MAP: Record<string, string> = {
  mira: "moss_audio_cf82d8cb-4799-11f1-aea0-d66da573c477",
  jamal: "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b",
  afifah: "moss_audio_b4d54c5a-225f-11f1-bf6e-065823da7bf2",
  aqil: "Malay_male_1_v1",
  nana: "Malay_female_1_v1",
  mila: "Malay_female_2_v1",
};
const DEFAULT_VOICE = VOICE_MAP.mira;
const EMOTIONS = ["fluent", "happy", "neutral", "surprised", "sad", "angry", "fearful", "disgusted", "calm"];
const MAX_CHARS = 5000;

function resolveVoice(input: string): string {
  const v = (input || "").trim();
  if (!v) return DEFAULT_VOICE;
  // Raw MiniMax id (cloned "moss_audio_*" or preset "Malay_*") → use as-is.
  if (/^moss_audio_/i.test(v) || /^[A-Za-z]+_(male|female)_\d/i.test(v)) return v;
  return VOICE_MAP[v.toLowerCase()] || DEFAULT_VOICE;
}

export async function POST(req: Request) {
  // ── Auth (OPTIONAL) ──────────────────────────────────────────────────
  // If TTS_API_KEY is set, require it. If not set, the endpoint is OPEN so it
  // works directly with no setup (uses the server's MINIMAX_API_KEY from env).
  const expected = (process.env.TTS_API_KEY || "").trim();
  if (expected) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = (process.env.MINIMAX_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "MINIMAX_API_KEY not configured" }, { status: 500 });
  }

  // ── Input ─────────────────────────────────────────────────────────────
  const b = await req.json().catch(() => ({} as any));
  const text = String(b?.text || "").trim().slice(0, MAX_CHARS);
  if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  const voiceId = resolveVoice(String(b?.voice || ""));
  const emRaw = String(b?.emotion || "fluent").toLowerCase();
  const emotion = EMOTIONS.includes(emRaw) ? emRaw : "fluent";
  const speed = Math.max(0.5, Math.min(2.0, Number(b?.speed) || 1.0));
  const language: "ms" | "en" = b?.language === "en" ? "en" : "ms";

  // ── Synthesize (MiniMax T2A v2) ───────────────────────────────────────
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
      return NextResponse.json({ ok: false, error: `MiniMax HTTP ${r.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const data = await r.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return NextResponse.json({ ok: false, error: `MiniMax: ${data.base_resp.status_msg}` }, { status: 502 });
    }
    const hex: string = data?.data?.audio || data?.audio_data || "";
    if (!hex) return NextResponse.json({ ok: false, error: "MiniMax returned no audio" }, { status: 502 });
    const bytes = Buffer.from(hex, "hex");

    // Duration — MiniMax returns audio_length (ms) in extra_info when available.
    const lenMs = Number(data?.extra_info?.audio_length);
    const durationSec = Number.isFinite(lenMs) && lenMs > 0 ? Number((lenMs / 1000).toFixed(2)) : null;

    // Host the MP3 on our public content bucket and return the URL.
    const key = `tts/${randomUUID()}.mp3`;
    const { publicUrl } = await uploadBufferToContent({ body: bytes, key, contentType: "audio/mpeg" });

    return NextResponse.json({
      ok: true,
      audio_url: publicUrl,
      duration_sec: durationSec,
      chars: text.length,
      voice: voiceId,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "TTS error" }, { status: 502 });
  }
}
