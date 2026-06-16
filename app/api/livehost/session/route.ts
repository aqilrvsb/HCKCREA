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
  const { action, sessionId, voiceChars, commentChars, sessionType } = body || {};

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
    if (typeof commentChars === "number" && commentChars >= 0) patch.comment_chars = Math.round(commentChars);
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
    // Pool: keep this user's serverless slot alive on heartbeat; free it on stop.
    if (action === "stop") {
      await admin
        .from("livehost_pool")
        .update({ status: "free", assigned_user_id: null, assigned_session_id: null, assigned_at: null, last_seen: null, updated_at: new Date().toISOString() })
        .eq("assigned_user_id", user.id)
        .eq("status", "busy");
    } else {
      await admin
        .from("livehost_pool")
        .update({ last_seen: new Date().toISOString() })
        .eq("assigned_user_id", user.id)
        .eq("status", "busy");
    }
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
  const url = new URL(req.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  // Run the independent prep (close stale sessions + load admin rates) in
  // parallel instead of one-after-another.
  const [rates] = await Promise.all([
    getSettings(["livehost_gpu_rate_hour", "livehost_voice_rate_1k", "livehost_audio_rate_gen", "livehost_warm_window_sec", "livehost_min_balance"]),
    closeStale(admin, user.id),
  ]);
  const gpuRate = parseFloat(rates["livehost_gpu_rate_hour"] || "6") || 6;
  // NOTE: allow a rate of exactly 0 (e.g. "live speech is free") — a plain
  // `|| 0.3` fallback would wrongly snap 0 back to 0.3.
  const _vr = parseFloat(rates["livehost_voice_rate_1k"] ?? "");
  const voiceRate = Number.isFinite(_vr) ? _vr : 0.3;
  // Audio-script TTS is billed PER 1,000 CHARACTERS (matches how MiniMax charges
  // us) — not flat per generate — so long scripts can never under-charge.
  const audioRateGen = parseFloat(rates["livehost_audio_rate_gen"] || "0.3") || 0.3;
  // GPU stays WARM (billed) after a stream stops until the watchdog/freeTimeout
  // scales it to $0 — this warm-but-not-streaming time is "testing/idle" overhead.
  const warmWindowSec = parseFloat(rates["livehost_warm_window_sec"] || "900") || 900;
  // Minimum credit balance: block Start / auto-stop the worker when the remaining
  // balance (credits − livehost cost) drops to this. Admin-settable, default RM5.
  const minBalance = parseFloat(rates["livehost_min_balance"] || "5") || 5;

  const now = Date.now();
  const periodStart = startParam
    ? new Date(malaysiaDayToUtcRange(startParam, "start")).getTime()
    : (() => { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); return m.getTime(); })();
  const periodEnd = endParam ? new Date(malaysiaDayToUtcRange(endParam, "end")).getTime() : now;
  const inPeriod = (t: number) => t >= periodStart && t <= periodEnd;

  // Fetch ALL sessions + ALL audio gens (all-time) + credits IN PARALLEL — the
  // balance is a wallet (not period-scoped) and the ledger needs a true running
  // balance from the start.
  const [{ data: sessions }, { data: gens }, { data: prof }] = await Promise.all([
    admin.from("live_sessions")
      .select("id, started_at, ended_at, voice_chars, comment_chars, session_type")
      .eq("user_id", user.id).order("started_at", { ascending: true }).limit(5000),
    admin.from("livehost_audio_gen")
      .select("id, chars, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: true }).limit(5000),
    admin.from("profiles").select("credits").eq("id", user.id).maybeSingle(),
  ]);
  const credits = Number(prof?.credits || 0);

  const asc = sessions || [];
  // Build ONE chronological ledger of every billable charge:
  //   • each session  → GPU(active) + warm-idle-after-it + its voice + comment
  //   • each audio gen → chars/1k × audio rate
  // Folding the warm-idle into the session that caused it keeps the running
  // balance exact (Σ ledger costs == total spent == credits − available).
  type Charge = { t: number; type: "live" | "nonLive" | "audioScript"; durationSec: number; chars: number; cost: number };
  const charges: Charge[] = [];
  for (let i = 0; i < asc.length; i++) {
    const s = asc[i];
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((end - start) / 1000));
    const nextStart = i + 1 < asc.length ? new Date(asc[i + 1].started_at).getTime() : now;
    const idleAfter = Math.min(warmWindowSec, Math.max(0, (nextStart - end) / 1000));
    const vChars = Number(s.voice_chars) || 0;
    const cChars = Number(s.comment_chars) || 0;
    const gpuCost = ((durSec + idleAfter) / 3600) * gpuRate;
    const cost = gpuCost + (vChars / 1000) * voiceRate + (cChars / 1000) * voiceRate;
    charges.push({
      t: start,
      type: s.session_type === "testing" ? "nonLive" : "live",
      durationSec: durSec,
      chars: vChars + cChars,
      cost,
    });
  }
  for (const g of gens || []) {
    charges.push({
      t: new Date(g.created_at).getTime(),
      type: "audioScript",
      durationSec: 0,
      chars: Number(g.chars) || 0,
      cost: ((Number(g.chars) || 0) / 1000) * audioRateGen,
    });
  }
  charges.sort((a, b) => a.t - b.t);

  // Running balance (all-time) → ledger rows for the selected period (newest first).
  let runSpent = 0;
  const TYPE_LABEL: Record<string, string> = { live: "Live", nonLive: "NON Live", audioScript: "Audio Script" };
  const ledgerAll = charges.map((c) => {
    runSpent += c.cost;
    return { at: new Date(c.t).toISOString(), type: c.type, typeLabel: TYPE_LABEL[c.type], durationSec: c.durationSec, chars: c.chars, cost: +c.cost.toFixed(2), balanceAfter: +(credits - runSpent).toFixed(2) };
  });
  const ledger = ledgerAll.filter((r) => inPeriod(new Date(r.at).getTime())).reverse();
  const allTimeSpent = runSpent;
  const available = +(credits - allTimeSpent).toFixed(2);

  // ---- Period category breakdown (the 4 cost cards) ----
  let liveSec = 0, liveChars = 0, liveCount = 0;
  let testSec = 0, testChars = 0, testCount = 0;
  let idleSec = 0, commentChars = 0;
  for (let i = 0; i < asc.length; i++) {
    const s = asc[i];
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((end - start) / 1000));
    if (inPeriod(start)) {
      commentChars += Number(s.comment_chars) || 0;
      if (s.session_type === "testing") { testSec += durSec; testChars += Number(s.voice_chars); testCount++; }
      else { liveSec += durSec; liveChars += Number(s.voice_chars); liveCount++; }
      const nextStart = i + 1 < asc.length ? new Date(asc[i + 1].started_at).getTime() : now;
      idleSec += Math.min(warmWindowSec, Math.max(0, (nextStart - end) / 1000));
    }
  }
  const gensP = (gens || []).filter((g) => inPeriod(new Date(g.created_at).getTime()));
  const audioGenerations = gensP.length;
  const audioChars = gensP.reduce((a, g) => a + Number(g.chars || 0), 0);
  const audioCost = (audioChars / 1000) * audioRateGen;

  const liveGpu = (liveSec / 3600) * gpuRate;
  const liveVoice = (liveChars / 1000) * voiceRate;
  const testGpu = (testSec / 3600) * gpuRate;
  const testVoice = (testChars / 1000) * voiceRate;
  const idleCost = (idleSec / 3600) * gpuRate;
  const commentCost = (commentChars / 1000) * voiceRate;
  const liveCost = liveGpu + liveVoice;
  const nonLiveCost = testGpu + testVoice + idleCost;
  const grandTotal = liveCost + nonLiveCost + audioCost + commentCost;

  return NextResponse.json({
    rates: { gpuRateHour: gpuRate, voiceRate1k: voiceRate, audioRateGen, warmWindowSec, currency: "RM" },
    // credit balance guard — wallet view (ALL-TIME): available = credits − all
    // livehost spending ever. This is the number shown as "Baki kredit" AND the
    // sidebar "Credit Balance" so they tally. spent here is all-time too.
    balance: { credits: +credits.toFixed(2), spent: +allTimeSpent.toFixed(2), available, minBalance, low: available <= minBalance },
    // chronological ledger (period-filtered, newest first) with running balance
    ledger,
    // 4-category breakdown (the source of truth for Usage + Dashboard):
    // Live = timed live, NON Live = ad-hoc play + warm idle, Audio Script =
    // pre-gen, Comment = AI replies to viewer comments (voice).
    costs: {
      audioScript: { generations: audioGenerations, chars: audioChars, cost: +audioCost.toFixed(2) },
      live: { sessions: liveCount, streamSec: liveSec, voiceChars: liveChars, gpuCost: +liveGpu.toFixed(2), voiceCost: +liveVoice.toFixed(2), cost: +liveCost.toFixed(2) },
      nonLive: { sessions: testCount, streamSec: testSec, voiceChars: testChars, gpuCost: +testGpu.toFixed(2), voiceCost: +testVoice.toFixed(2), idleSec, idleCost: +idleCost.toFixed(2), cost: +nonLiveCost.toFixed(2) },
      comment: { chars: commentChars, cost: +commentCost.toFixed(2) },
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
