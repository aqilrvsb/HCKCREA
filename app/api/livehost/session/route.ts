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
  const { action, sessionId, voiceChars, sessionType } = body || {};

  if (action === "start") {
    await closeStale(admin, user.id);
    // also close any still-active session cleanly (double Start, new tab…)
    await admin
      .from("live_sessions")
      .update({ ended_at: new Date().toISOString(), status: "ended" })
      .eq("user_id", user.id)
      .eq("status", "active");
    // session_type: "live" = streamed with a set duration; "testing" = ad-hoc play (no duration)
    const stype = sessionType === "live" ? "live" : "testing";
    const { data, error } = await admin
      .from("live_sessions")
      .insert({ user_id: user.id, session_type: stype })
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

  const rates = await getSettings(["livehost_gpu_rate_hour", "livehost_voice_rate_1k", "livehost_audio_rate_gen", "livehost_warm_window_sec", "livehost_min_balance"]);
  const gpuRate = parseFloat(rates["livehost_gpu_rate_hour"] || "6") || 6;
  const voiceRate = parseFloat(rates["livehost_voice_rate_1k"] || "0.3") || 0.3;
  const audioRateGen = parseFloat(rates["livehost_audio_rate_gen"] || "0.1") || 0.1;
  // GPU stays WARM (billed) after a stream stops until the watchdog/freeTimeout
  // scales it to $0 — this warm-but-not-streaming time is "testing/idle" overhead.
  const warmWindowSec = parseFloat(rates["livehost_warm_window_sec"] || "900") || 900;
  // Minimum credit balance: block Start / auto-stop the worker when the remaining
  // balance (credits − livehost cost) drops to this. Admin-settable, default RM5.
  const minBalance = parseFloat(rates["livehost_min_balance"] || "5") || 5;

  const { data: sessions } = await admin
    .from("live_sessions")
    .select("id, started_at, ended_at, last_seen, voice_chars, status, session_type")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(200);

  const now = Date.now();
  const periodStart = startParam
    ? new Date(malaysiaDayToUtcRange(startParam, "start")).getTime()
    : (() => { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); return m.getTime(); })();
  const periodEnd = endParam ? new Date(malaysiaDayToUtcRange(endParam, "end")).getTime() : now;
  const inPeriod = (t: number) => t >= periodStart && t <= periodEnd;

  // Per-session display rows (newest first) — tagged with type + its own cost.
  const rows = (sessions || []).map((s) => {
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((end - new Date(s.started_at).getTime()) / 1000));
    const gpuCost = (durSec / 3600) * gpuRate;
    const voiceCost = (Number(s.voice_chars) / 1000) * voiceRate;
    return {
      id: s.id,
      startedAt: s.started_at,
      status: s.status,
      type: s.session_type === "testing" ? "testing" : "live",
      durationSec: durSec,
      voiceChars: Number(s.voice_chars),
      gpuCost: +gpuCost.toFixed(2),
      voiceCost: +voiceCost.toFixed(2),
      totalCost: +(gpuCost + voiceCost).toFixed(2),
    };
  });

  // Aggregate by category for the selected period. Idle = warm-but-not-streaming
  // GPU between consecutive sessions (capped at the warm window) + trailing warm.
  const asc = [...(sessions || [])].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );
  let liveSec = 0, liveChars = 0, liveCount = 0;
  let testSec = 0, testChars = 0, testCount = 0;
  let idleSec = 0;
  for (let i = 0; i < asc.length; i++) {
    const s = asc[i];
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((end - start) / 1000));
    if (inPeriod(start)) {
      if (s.session_type === "testing") { testSec += durSec; testChars += Number(s.voice_chars); testCount++; }
      else { liveSec += durSec; liveChars += Number(s.voice_chars); liveCount++; }
    }
    // warm-idle after this session (worker up, not streaming) → counts as testing overhead
    const nextStart = i + 1 < asc.length ? new Date(asc[i + 1].started_at).getTime() : now;
    const gapSec = Math.max(0, (nextStart - end) / 1000);
    if (inPeriod(end)) idleSec += Math.min(warmWindowSec, gapSec);
  }

  // ---- Cost Audio Script: each row in livehost_audio_gen = one billable generation ----
  const { data: gens } = await admin
    .from("livehost_audio_gen")
    .select("chars, created_at")
    .eq("user_id", user.id)
    .gte("created_at", new Date(periodStart).toISOString())
    .lte("created_at", new Date(periodEnd).toISOString());
  const audioGenerations = (gens || []).length;
  const audioChars = (gens || []).reduce((a, g) => a + Number(g.chars || 0), 0);
  const audioCost = audioGenerations * audioRateGen;

  const liveGpu = (liveSec / 3600) * gpuRate;
  const liveVoice = (liveChars / 1000) * voiceRate;
  const testGpu = (testSec / 3600) * gpuRate;
  const testVoice = (testChars / 1000) * voiceRate;
  const idleCost = (idleSec / 3600) * gpuRate;
  const liveCost = liveGpu + liveVoice;
  const testingCost = testGpu + testVoice + idleCost;
  const grandTotal = liveCost + testingCost + audioCost;

  // Credit balance guard: available = credits − livehost cost (this period).
  const { data: prof } = await admin.from("profiles").select("credits").eq("id", user.id).maybeSingle();
  const credits = Number(prof?.credits || 0);
  const available = +(credits - grandTotal).toFixed(2);

  return NextResponse.json({
    rates: { gpuRateHour: gpuRate, voiceRate1k: voiceRate, audioRateGen, warmWindowSec, currency: "RM" },
    // credit balance guard (Start blocked + worker auto-stopped at/below minBalance)
    balance: { credits: +credits.toFixed(2), spent: +grandTotal.toFixed(2), available, minBalance, low: available <= minBalance },
    sessions: rows,
    // 3-category breakdown (the source of truth for Usage + Dashboard)
    costs: {
      audioScript: { generations: audioGenerations, chars: audioChars, cost: +audioCost.toFixed(2) },
      live: { sessions: liveCount, streamSec: liveSec, voiceChars: liveChars, gpuCost: +liveGpu.toFixed(2), voiceCost: +liveVoice.toFixed(2), cost: +liveCost.toFixed(2) },
      testing: { sessions: testCount, streamSec: testSec, voiceChars: testChars, gpuCost: +testGpu.toFixed(2), voiceCost: +testVoice.toFixed(2), idleSec, idleCost: +idleCost.toFixed(2), cost: +testingCost.toFixed(2) },
      total: +grandTotal.toFixed(2),
    },
    // backward-compatible fields (legacy consumers)
    month: {
      streamSec: liveSec + testSec,
      voiceChars: liveChars + testChars,
      gpuCost: +(liveGpu + testGpu).toFixed(2),
      voiceCost: +(liveVoice + testVoice).toFixed(2),
      totalCost: +grandTotal.toFixed(2),
    },
    audio: { generations: audioGenerations, chars: audioChars, cost: +audioCost.toFixed(2) },
    gpu: { streamSec: liveSec + testSec, cost: +(liveGpu + testGpu).toFixed(2) },
  });
}
