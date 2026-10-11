import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/tts";

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
// The MiniMax call itself lives in lib/tts.ts (shared with the Motion tab).

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  const b = await req.json().catch(() => ({} as any));
  const text = String(b?.text || "").trim();
  if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });

  const r = await synthesizeSpeech({
    text,
    voice: String(b?.voice || ""),
    emotion: String(b?.emotion || "fluent"),
    speed: Number(b?.speed) || 1.0,
    language: b?.language === "en" ? "en" : "ms",
  });
  if (!r.ok) {
    const status = r.error.includes("not configured") ? 500 : 502;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({
    ok: true,
    audio_url: r.audioUrl,
    duration_sec: r.durationSec,
    chars: r.chars,
    voice: r.voice,
  });
}
