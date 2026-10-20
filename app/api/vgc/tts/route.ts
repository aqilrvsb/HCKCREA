import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { synthesizeSpeech } from "@/lib/tts";
import { tokenMatches } from "@/lib/motion";

// POST /api/vgc/tts — called BY Claude Code inside a Custom Style (VGC) run
// (the `pl-tts` command in modal_vgc.py) when the client picked an AI voice
// (Mira, Afifah…) for the voice-over. Auth = the run's own tts token; only the
// chosen voice, only while the card is running. The MiniMax key stays here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS_PER_CALL = 1500;
const MAX_CALLS_PER_STEP = 60;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = String(b?.history_id ?? "");
  const token = String(b?.token ?? "");
  const text = String(b?.text ?? "").replace(/\s+/g, " ").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  if (text.length > MAX_CHARS_PER_CALL) return NextResponse.json({ ok: false, error: `max ${MAX_CHARS_PER_CALL} characters per call — split it` }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, status, metadata").eq("id", id).maybeSingle();
  const meta = (row?.metadata ?? {}) as Record<string, any>;
  const tts = meta.vgc?.tts as { voice?: string; token?: string; calls?: number } | undefined;
  if (!row || meta.feature !== "motion-vgc" || !tts?.token || !tokenMatches(token, tts.token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "run not active" }, { status: 409 });
  if ((tts.calls ?? 0) >= MAX_CALLS_PER_STEP) return NextResponse.json({ ok: false, error: "voice-over limit reached for this step" }, { status: 429 });

  const emotion = String(b?.emotion ?? "fluent");
  const speed = Number(b?.speed) || 1;
  const r = await synthesizeSpeech({ text, voice: tts.voice, emotion, speed, language: "ms", keyPrefix: `vgc-tts/${row.user_id}` });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });

  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  const m = (cur?.metadata ?? meta) as Record<string, any>;
  await admin.from("history").update({ metadata: { ...m, vgc: { ...m.vgc, tts: { ...m.vgc?.tts, calls: (m.vgc?.tts?.calls ?? 0) + 1 } } } }).eq("id", id);
  return NextResponse.json({ ok: true, url: r.audioUrl, duration_sec: r.durationSec ?? null, voice: tts.voice });
}
