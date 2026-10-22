import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches } from "@/lib/motion";
import { withDeadline } from "@/lib/openrouter";
import { CLIPPER_JOB_TAB, cleanOptions, directClips, type HeatPoint, type Line } from "@/lib/clipper";

// POST /api/clipper/plan — called BY the Modal analysis job once it has the transcript + heatmap. Auth = the
// row's plan_token (only Modal has it). The master director (model_motion — Sonnet 5.5) picks the clips here,
// so the admin's model / provider settings apply.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const BUDGET_MS = 270_000;

export async function POST(req: Request) {
  const t0 = Date.now();
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.history_id || "");
  const token = String(b?.token || "");
  if (!id || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, tab, status, metadata").eq("id", id).maybeSingle();
  if (!row || row.tab !== CLIPPER_JOB_TAB || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "row not pending" }, { status: 409 });

  const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
  const lines: Line[] = (Array.isArray(b?.segments) ? b.segments : []).slice(0, 20000)
    .map((l: any) => {
      // the speaker (diarization) + audio events at the line, when the analysis has them
      const spk = typeof l?.spk === "string" && /^S\d{1,2}$/.test(l.spk) ? l.spk : undefined;
      const tags = Array.isArray(l?.tags) ? l.tags.map((t: unknown) => String(t ?? "").toUpperCase()).filter((t: string) => /^[A-Z ]{3,16}$/.test(t)).slice(0, 4) : [];
      return { start: num(l?.start), end: num(l?.end), text: String(l?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400), ...(spk ? { spk } : {}), ...(tags.length ? { tags } : {}) };
    })
    .filter((l: Line) => l.text && l.end > l.start);
  const heatmap: HeatPoint[] = (Array.isArray(b?.heatmap) ? b.heatmap : []).slice(0, 400)
    .map((h: any) => ({ start: num(h?.start), end: num(h?.end), value: Math.max(0, Math.min(1, Number(h?.value) || 0)) }))
    .filter((h: HeatPoint) => h.end > h.start);
  if (lines.length < 3) return NextResponse.json({ ok: false, error: "no transcript" }, { status: 400 });
  const m = b?.meta ?? {};
  const meta = {
    title: m.title ? String(m.title).slice(0, 200) : null,
    channel: m.channel ? String(m.channel).slice(0, 120) : null,
    duration: Number(m.duration) || lines[lines.length - 1].end,
    language: m.language ? String(m.language).slice(0, 8) : null,
  };
  const options = cleanOptions(row.metadata?.options);
  try {
    await admin.from("history").update({ metadata: { ...(row.metadata || {}), stage: "director" } }).eq("id", id);
    const res = await withDeadline(t0 + BUDGET_MS, () => directClips({ meta, heatmap, lines, options, deadline: t0 + BUDGET_MS }));
    return NextResponse.json({ ok: true, summary: res.summary, clips: res.clips, director: res.director, fallback: res.fallback });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "director failed" }, { status: 502 });
  }
}
