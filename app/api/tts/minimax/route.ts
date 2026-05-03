import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/tts/minimax — preview narration audio for a single scene
// (used by the Fairytale tab "preview voice" button).
//
// Returns: { ok: true, audio_b64, mime } so the client can play it
// without saving to storage. Production renders use the same MiniMax
// endpoint inside modal_fairytale.py — this route is preview-only.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "MINIMAX_API_KEY not configured on Vercel" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim().slice(0, 500);
  const voiceId = String(body?.voice_id || "Malay_BellaSoothing");
  const speed = Math.max(0.5, Math.min(2.0, Number(body?.speed) || 1.0));

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  try {
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
        language_boost: "Malay",
        output_format: "hex",
        voice_setting: {
          voice_id: voiceId,
          speed,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          format: "mp3",
          sample_rate: 32000,
          channel: 1,
        },
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return NextResponse.json(
        { error: `MiniMax HTTP ${r.status}`, detail: txt.slice(0, 300) },
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
      return NextResponse.json(
        { error: "MiniMax returned no audio" },
        { status: 502 }
      );
    }

    const bytes = Buffer.from(hex, "hex");
    const audioB64 = bytes.toString("base64");

    return NextResponse.json({
      ok: true,
      audio_b64: audioB64,
      mime: "audio/mpeg",
      char_count: text.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "TTS network error" },
      { status: 500 }
    );
  }
}
