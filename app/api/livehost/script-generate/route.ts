import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/livehost/script-generate
// Renders MiniMax audio for a script DRAFT so the user can hear it before saving
// (Scripts tab "Generate"). Each call is a BILLABLE audio generation — we record
// one row in livehost_audio_gen (the Audio usage meter). Returns audio_b64 so the
// client can play it now and (on Save) upload it via /api/livehost/scripts.

export const runtime = "nodejs";
export const maxDuration = 300; // long scripts → multiple MiniMax calls merged
export const dynamic = "force-dynamic";

const EMOTIONS = ["fluent", "happy", "neutral", "surprised", "sad", "angry", "fearful", "disgusted", "calm"];

// MiniMax t2a_v2 caps a request ~5k chars. We accept ANY length, split into
// ≤CHUNK_CHARS pieces at sentence boundaries, synthesize each, then merge the
// raw PCM back into one clip (same 24kHz mono format → seamless concat).
const CHUNK_CHARS = 2500; // per playback piece (~2.5 min, ~7MB) — fast piece downloads
const HARD_MAX = 40000; // safety bound (~8 chunks, ~5.7k words) to avoid timeouts/abuse
const SR = 24000;
const BUCKET = "livehost-audio";
const SIGN_TTL = 60 * 60 * 6; // 6h

// Split text into ≤CHUNK_CHARS chunks, breaking at sentence ends (. ! ? …) and
// falling back to word boundaries so we never cut a word in half.
function chunkText(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) || [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > max) {
      // a single huge sentence → split by words
      if (cur) { out.push(cur); cur = ""; }
      let w = "";
      for (const word of s.split(/\s+/)) {
        if ((w + " " + word).trim().length > max) { if (w) out.push(w); w = word; }
        else w = (w ? w + " " : "") + word;
      }
      if (w) cur = w;
    } else if ((cur + s).length > max) {
      if (cur) out.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [text];
}

// Trim near-silence from both ends of a 16-bit PCM buffer, keeping a small pad,
// so merged chunks don't accumulate MiniMax's per-clip padding into dead air.
function trimSilence(pcm: Buffer, padMs = 60, thresh = 300): Buffer {
  const n = pcm.length / 2;
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) <= thresh) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) <= thresh) b--;
  if (a >= b) return pcm;
  const pad = Math.floor((SR * padMs) / 1000);
  a = Math.max(0, a - pad); b = Math.min(n - 1, b + pad);
  return pcm.subarray(a * 2, (b + 1) * 2);
}

// Wrap raw 16-bit PCM in a minimal 44-byte WAV header (mono assumed).
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);          // PCM fmt chunk size
  h.writeUInt16LE(1, 20);           // audio format = PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(16, 34);          // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "MINIMAX_API_KEY not configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const text = String(b?.text || "").trim().slice(0, HARD_MAX);
  const voiceId = String(b?.voice_id || "");
  const speed = Math.max(0.5, Math.min(2.0, Number(b?.speed) || 1.0));
  const vol = Math.max(0.1, Math.min(10, Number(b?.volume) || 1.5));
  const emRaw = String(b?.emotion || "fluent");
  const emotion = EMOTIONS.includes(emRaw) ? emRaw : "fluent";
  const scriptId = b?.script_id ? String(b.script_id) : null;
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (!voiceId) return NextResponse.json({ error: "voice_id required" }, { status: 400 });

  // Synthesize ONE chunk → raw PCM buffer (throws on failure).
  async function synth(chunk: string): Promise<Buffer> {
    const r = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "speech-2.6-turbo",
        text: chunk,
        stream: false,
        language_boost: "Malay",
        output_format: "hex",
        voice_setting: { voice_id: voiceId, speed, vol, pitch: 0, emotion },
        // RAW PCM at the avatar's native 24 kHz mono — no lossy mp3, no resample.
        audio_setting: { format: "pcm", sample_rate: SR, channel: 1 },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`MiniMax HTTP ${r.status}: ${t.slice(0, 200)}`);
    }
    const data = await r.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw new Error(`MiniMax: ${data.base_resp.status_msg}`);
    }
    const hex: string = data?.audio_data || data?.data?.audio || "";
    if (!hex) throw new Error("MiniMax returned no audio");
    return Buffer.from(hex, "hex");
  }

  try {
    const chunks = chunkText(text, CHUNK_CHARS);
    const admin = createAdminClient();
    // CHUNKED PLAYBACK: synthesize each piece and upload it as its OWN small WAV.
    // The studio sends the ordered list of piece URLs; the worker plays them
    // gaplessly (downloads piece N+1 while N plays). No merge → no giant file →
    // no download-timeout, instant start, unlimited length.
    const audioPaths: string[] = [];
    const audioUrls: string[] = [];
    const batch = randomUUID();
    for (let i = 0; i < chunks.length; i++) {
      const pcm = trimSilence(await synth(chunks[i]));
      if (!pcm.length) continue;
      const wav = pcmToWav(pcm, SR, 1);
      const path = `${user.id}/draft-${batch}-${String(i).padStart(3, "0")}.wav`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: true });
      if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
      audioPaths.push(path);
      audioUrls.push(signed?.signedUrl || "");
    }
    if (!audioPaths.length) return NextResponse.json({ error: "MiniMax returned no audio" }, { status: 502 });

    // Billable: one generation event; chars = the FULL text length.
    await admin.from("livehost_audio_gen").insert({ user_id: user.id, script_id: scriptId, chars: text.length });

    return NextResponse.json({ ok: true, audio_urls: audioUrls, audio_paths: audioPaths, mime: "audio/wav", chars: text.length, parts: audioPaths.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "TTS network error" }, { status: 502 });
  }
}
