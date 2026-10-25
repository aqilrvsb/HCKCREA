import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { withDeadline } from "@/lib/openrouter";
import {
  MAX_ANALYSIS_CLIPS, cleanOptions, directClips, isFreshClip,
  type ClipperAnalysis, type ClipperClip, type HeatPoint, type Line,
} from "@/lib/clipper";

// POST /api/clipper/more { job_id, count } — "➕ Cari lagi klip": the master director reads the same video again and
// finds MORE clips, other moments than the ones the analysis already has (and other topics). It works from the
// analysis' saved transcript (no new download / transcription); the new clips are appended to the analysis with
// their round number (`batch`), so the clips the client already ticked / edited keep their place.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const BUDGET_MS = 270_000;
const RUNNING_MS = 6 * 60_000; // one round at a time per analysis

export async function POST(req: Request) {
  const t0 = Date.now();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "clipper"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const jobId = String(b?.job_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
  const want = Math.max(1, Math.min(20, Math.round(Number(b?.count) || 10)));

  const admin = createAdminClient();
  const read = async () => (await admin.from("history").select("id, user_id, status, metadata").eq("id", jobId).maybeSingle()).data as any;
  const row = await read();
  if (!row || row.user_id !== user.id || row.metadata?.feature !== "clipper-analysis") {
    return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
  }
  const a = row.metadata?.analysis as ClipperAnalysis | undefined;
  if (row.status !== "done" || !a) return NextResponse.json({ error: "Analisa belum siap." }, { status: 409 });
  const have = Array.isArray(a.clips) ? a.clips : [];
  if (have.length >= MAX_ANALYSIS_CLIPS) {
    return NextResponse.json({ error: `Analisa ini sudah ada ${have.length} klip (maksimum ${MAX_ANALYSIS_CLIPS}).` }, { status: 409 });
  }
  const running = Number(row.metadata?.more_at) || 0;
  if (running && Date.now() - running < RUNNING_MS) {
    return NextResponse.json({ error: "AI sedang cari klip baru untuk video ini — tunggu sekejap." }, { status: 409 });
  }
  if (!a.transcript_url) return NextResponse.json({ error: "Transkrip video ini tiada — analisa semula video." }, { status: 409 });

  // mark the round as running (a fresh read: the Studio may have just saved previews into the same metadata)
  const mark = async (patch: Record<string, unknown>) => {
    const cur = await read();
    await admin.from("history").update({ metadata: { ...(cur?.metadata || {}), ...patch } }).eq("id", jobId);
  };
  await mark({ more_at: Date.now() });

  try {
    // the analysis' own transcript (lines with speakers / audio tags), as the director first read it
    const tr = await fetch(a.transcript_url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const raw = tr.ok ? await tr.json().catch(() => null) : null;
    const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
    const lines: Line[] = (Array.isArray(raw) ? raw : []).slice(0, 20000)
      .map((l: any) => {
        const spk = typeof l?.spk === "string" && /^S\d{1,2}$/.test(l.spk) ? l.spk : undefined;
        const tags = Array.isArray(l?.tags) ? l.tags.map((t: unknown) => String(t ?? "").toUpperCase()).filter((t: string) => /^[A-Z ]{3,16}$/.test(t)).slice(0, 4) : [];
        return { start: num(l?.start), end: num(l?.end), text: String(l?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400), ...(spk ? { spk } : {}), ...(tags.length ? { tags } : {}) };
      })
      .filter((l: Line) => l.text && l.end > l.start);
    if (lines.length < 3) throw new Error("Transkrip video ini tidak dapat dibaca — analisa semula video.");
    const heatmap: HeatPoint[] = (Array.isArray(a.heatmap) ? a.heatmap : []).filter((h) => h && h.end > h.start);
    const options = cleanOptions({ ...(row.metadata?.options || {}), count: want });
    const taken = have.map((c) => ({ start: Number(c.start), end: Number(c.end), title: c.title }));
    const res = await withDeadline(t0 + BUDGET_MS, () => directClips({
      meta: { title: a.title ?? null, channel: a.channel ?? null, duration: Number(a.duration) || lines[lines.length - 1].end, language: a.language ?? null },
      heatmap, lines, options, deadline: t0 + BUDGET_MS, exclude: taken,
    }));
    // the round's number, and the clips held to "another moment" once more (both against the analysis as it is now)
    const now = await read();
    const cur = ((now?.metadata?.analysis?.clips ?? have) as ClipperClip[]);
    const batch = Math.max(0, ...cur.map((c) => Number(c.batch) || 0)) + 1;
    const added: ClipperClip[] = [];
    for (const c of res.clips) {
      if (cur.length + added.length >= MAX_ANALYSIS_CLIPS) break;
      if (!isFreshClip(c, [...cur, ...added])) continue;
      added.push({ ...c, batch });
    }
    const meta = now?.metadata || row.metadata || {};
    const { more_at: _drop, ...rest } = meta;
    await admin.from("history").update({
      metadata: { ...rest, analysis: { ...(meta.analysis || a), clips: [...cur, ...added] } },
    }).eq("id", jobId);
    if (!added.length) {
      return NextResponse.json({ ok: true, added: 0, batch, notice: "AI tidak jumpa momen kuat lain dalam video ini — klip terbaik sudah diambil." });
    }
    return NextResponse.json({ ok: true, added: added.length, batch, fallback: res.fallback });
  } catch (e: any) {
    const cur = await read();
    const { more_at: _drop, ...rest } = cur?.metadata || {};
    await admin.from("history").update({ metadata: rest }).eq("id", jobId);
    return NextResponse.json({ error: e?.message || "Gagal cari klip baru — cuba lagi." }, { status: 502 });
  }
}
