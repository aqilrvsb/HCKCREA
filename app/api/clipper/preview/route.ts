import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { clipPolish } from "@/lib/clipper-polish";
import { clipKey, previewWords, type PolishRef, type TLine } from "@/lib/clipper-preview";

// POST /api/clipper/preview { job_id, start, end, title?, polish? } — the Studio's live preview of one clip:
// its words (from the analysis transcript, clip seconds) and, with polish on, the keyword colours / emoji /
// zooms (one quick AI call per clip, kept on the analysis row — the render reuses it, so the clip comes out
// the way the preview showed it). Free, like the analysis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// one warm instance serves many previews of the same analysis: its transcript is read once
const TRANSCRIPTS = new Map<string, { at: number; lines: TLine[] }>();

async function transcript(url: string): Promise<TLine[] | null> {
  const hit = TRANSCRIPTS.get(url);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.lines;
  const r = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) return null;
  if (TRANSCRIPTS.size > 20) TRANSCRIPTS.delete(TRANSCRIPTS.keys().next().value as string);
  TRANSCRIPTS.set(url, { at: Date.now(), lines: j as TLine[] });
  return j as TLine[];
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "clipper"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const jobId = String(b?.job_id || "");
  const start = Number(b?.start), end = Number(b?.end);
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 3 || end - start > 130) {
    return NextResponse.json({ error: "Klip tidak sah." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: job } = await admin.from("history").select("id, user_id, status, metadata").eq("id", jobId).maybeSingle();
  if (!job || job.user_id !== user.id || (job as any).metadata?.feature !== "clipper-analysis" || job.status !== "done") {
    return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
  }
  const url = String((job as any).metadata?.analysis?.transcript_url || "");
  const lines = url.startsWith("https://") ? await transcript(url) : null;
  if (!lines) return NextResponse.json({ error: "Transkrip analisa ini tiada — pratonton tak dapat dibuat." }, { status: 409 });
  const { words, aligned } = previewWords(lines, start, end);

  const key = clipKey(start, end);
  let ref = ((job as any).metadata?.previews ?? {})[key] as (PolishRef & { at?: number }) | undefined;
  if (b?.polish && !ref && words.length >= 8) {
    const title = String(b?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    const p = await clipPolish(words.map((w, i) => ({ i, ...w })), end - start, title, Date.now() + 50_000);
    if (p.keywords.length || p.zooms.length) {
      ref = { words: words.map((w) => w.w), keywords: p.keywords, zooms: p.zooms, at: Date.now() };
      // kept on the analysis row (the newest 40 clips) — read fresh so a parallel preview isn't lost
      const { data: cur } = await admin.from("history").select("metadata").eq("id", jobId).maybeSingle();
      const all = { ...((cur?.metadata as any)?.previews ?? {}), [key]: ref } as Record<string, PolishRef & { at?: number }>;
      const keep = Object.entries(all).sort((x, y) => (y[1].at ?? 0) - (x[1].at ?? 0)).slice(0, 40);
      await admin.from("history").update({ metadata: { ...(cur?.metadata || {}), previews: Object.fromEntries(keep) } }).eq("id", jobId);
    }
  }
  // the polish was made on these very words; a transcript read differently (rare) drops it rather than misplace it
  const fits = ref && ref.words.length === words.length;
  return NextResponse.json({
    ok: true, words, aligned,
    keywords: fits ? ref!.keywords : [], zooms: fits ? ref!.zooms : [], polished: !!fits,
  });
}
