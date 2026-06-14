import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

// Server-side streaming session metering — the source of truth for billing.
// start     → closes any stale session, opens a new row (exact start second)
// heartbeat → bumps last_seen + cumulative voice chars (every ~30s while live)
// stop      → exact end second, status 'ended'
// Crash safety: any 'active' session whose last_seen is older than STALE_MS is
// closed at last_seen with status 'crashed' (checked lazily on start/usage).

const STALE_MS = 60 * 1000; // no heartbeat for 60s (laptop off / crash) → close session at last_seen

async function closeStale(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: stale } = await admin
    .from("live_sessions")
    .select("id, last_seen")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("last_seen", cutoff);
  for (const s of stale || []) {
    await admin
      .from("live_sessions")
      .update({ ended_at: s.last_seen, status: "crashed" })
      .eq("id", s.id);
  }
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const { action, sessionId, voiceChars } = body || {};

  if (action === "start") {
    await closeStale(admin, user.id);
    // also close any still-active session cleanly (double Start, new tab…)
    await admin
      .from("live_sessions")
      .update({ ended_at: new Date().toISOString(), status: "ended" })
      .eq("user_id", user.id)
      .eq("status", "active");
    const { data, error } = await admin
      .from("live_sessions")
      .insert({ user_id: user.id })
      .select("id, started_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sessionId: data.id, startedAt: data.started_at });
  }

  if (action === "heartbeat" || action === "stop") {
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const patch: Record<string, unknown> = { last_seen: new Date().toISOString() };
    if (typeof voiceChars === "number" && voiceChars >= 0) patch.voice_chars = Math.round(voiceChars);
    if (action === "stop") {
      patch.ended_at = new Date().toISOString();
      patch.status = "ended";
    }
    const { error } = await admin
      .from("live_sessions")
      .update(patch)
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// GET → rates + session history + totals. Optional ?start=YYYY-MM-DD&end=...
// (MYT) filters the period totals; defaults to this calendar month.
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  await closeStale(admin, user.id);

  const url = new URL(req.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  const rates = await getSettings(["livehost_gpu_rate_hour", "livehost_voice_rate_1k", "livehost_audio_rate_gen"]);
  const gpuRate = parseFloat(rates["livehost_gpu_rate_hour"] || "6") || 6;
  const voiceRate = parseFloat(rates["livehost_voice_rate_1k"] || "0.3") || 0.3;
  const audioRateGen = parseFloat(rates["livehost_audio_rate_gen"] || "0.1") || 0.1;

  const { data: sessions } = await admin
    .from("live_sessions")
    .select("id, started_at, ended_at, last_seen, voice_chars, status")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(200);

  const now = Date.now();
  const periodStart = startParam
    ? new Date(malaysiaDayToUtcRange(startParam, "start")).getTime()
    : (() => { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); return m.getTime(); })();
  const periodEnd = endParam ? new Date(malaysiaDayToUtcRange(endParam, "end")).getTime() : now;

  let monthSec = 0, monthChars = 0;
  const rows = (sessions || []).map((s) => {
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((end - new Date(s.started_at).getTime()) / 1000));
    const gpuCost = (durSec / 3600) * gpuRate;
    const voiceCost = (Number(s.voice_chars) / 1000) * voiceRate;
    const st = new Date(s.started_at).getTime();
    if (st >= periodStart && st <= periodEnd) {
      monthSec += durSec;
      monthChars += Number(s.voice_chars);
    }
    return {
      id: s.id,
      startedAt: s.started_at,
      status: s.status,
      durationSec: durSec,
      voiceChars: Number(s.voice_chars),
      gpuCost: +gpuCost.toFixed(2),
      voiceCost: +voiceCost.toFixed(2),
      totalCost: +(gpuCost + voiceCost).toFixed(2),
    };
  });

  // ---- Audio usage: each row in livehost_audio_gen = one billable generation ----
  const { data: gens } = await admin
    .from("livehost_audio_gen")
    .select("chars, created_at")
    .eq("user_id", user.id)
    .gte("created_at", new Date(periodStart).toISOString())
    .lte("created_at", new Date(periodEnd).toISOString());
  const audioGenerations = (gens || []).length;
  const audioChars = (gens || []).reduce((a, g) => a + Number(g.chars || 0), 0);
  const audioCost = audioGenerations * audioRateGen;

  const gpuMonthCost = (monthSec / 3600) * gpuRate;

  return NextResponse.json({
    rates: { gpuRateHour: gpuRate, voiceRate1k: voiceRate, audioRateGen, currency: "RM" },
    sessions: rows,
    month: {
      streamSec: monthSec,
      voiceChars: monthChars,
      gpuCost: +gpuMonthCost.toFixed(2),
      voiceCost: +((monthChars / 1000) * voiceRate).toFixed(2),
      totalCost: +(gpuMonthCost + audioCost).toFixed(2),
    },
    audio: {
      generations: audioGenerations,
      chars: audioChars,
      cost: +audioCost.toFixed(2),
    },
    gpu: {
      streamSec: monthSec,
      cost: +gpuMonthCost.toFixed(2),
    },
  });
}
