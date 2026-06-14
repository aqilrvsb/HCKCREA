import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/livehost/script-generate
// Renders MiniMax audio for a script DRAFT so the user can hear it before saving
// (Scripts tab "Generate"). Each call is a BILLABLE audio generation — we record
// one row in livehost_audio_gen (the Audio usage meter). Returns audio_b64 so the
// client can play it now and (on Save) upload it via /api/livehost/scripts.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const EMOTIONS = ["fluent", "happy", "neutral", "surprised", "sad", "angry", "fearful", "disgusted", "calm"];

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "MINIMAX_API_KEY not configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const text = String(b?.text || "").trim().slice(0, 5000);
  const voiceId = String(b?.voice_id || "");
  const speed = Math.max(0.5, Math.min(2.0, Number(b?.speed) || 1.0));
  const vol = Math.max(0.1, Math.min(10, Number(b?.volume) || 1.5));
  const emRaw = String(b?.emotion || "fluent");
  const emotion = EMOTIONS.includes(emRaw) ? emRaw : "fluent";
  const scriptId = b?.script_id ? String(b.script_id) : null;
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (!voiceId) return NextResponse.json({ error: "voice_id required" }, { status: 400 });

  try {
    const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "speech-2.6-turbo",
        text,
        stream: false,
        language_boost: "Malay",
        output_format: "hex",
        voice_setting: { voice_id: voiceId, speed, vol, pitch: 0, emotion },
        audio_setting: { format: "mp3", sample_rate: 32000, channel: 1 },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ error: `MiniMax HTTP ${r.status}`, detail: t.slice(0, 300) }, { status: 502 });
    }
    const data = await r.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return NextResponse.json({ error: `MiniMax: ${data.base_resp.status_msg}` }, { status: 502 });
    }
    const hex: string = data?.audio_data || data?.data?.audio || "";
    if (!hex) return NextResponse.json({ error: "MiniMax returned no audio" }, { status: 502 });
    const audioB64 = Buffer.from(hex, "hex").toString("base64");

    // Billable: one generation event (the Audio meter counts these).
    const admin = createAdminClient();
    await admin.from("livehost_audio_gen").insert({ user_id: user.id, script_id: scriptId, chars: text.length });

    return NextResponse.json({ ok: true, audio_b64: audioB64, mime: "audio/mpeg", chars: text.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "TTS network error" }, { status: 500 });
  }
}
