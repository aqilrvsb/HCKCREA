import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { clipPolish } from "@/lib/clipper-polish";
import { getMotionConfig } from "@/lib/motion";
import { HEADLINE_VERSION, enrichHeadlines } from "@/lib/motion-headline";
import { clipKey, previewWords, type PolishRef, type SrcFaces, type TLine } from "@/lib/clipper-preview";

// POST /api/clipper/preview { job_id, start, end, title?, polish?, faces? } — the Studio's live preview of one clip:
// its words (from the analysis transcript, clip seconds); with polish, the keyword colours / emoji / zooms (one
// quick AI call per clip, kept on the analysis row — the render reuses it, so the clip comes out the way the
// preview showed it); with faces, the speaker's face 4× a second (Modal clip_faces — the preview keeps captions
// clear of it and frames the speaker, as the render's face track does). Free, like the analysis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

/** The speaker's face over one clip of the source (Modal clip_faces, ≤ 100 s), or undefined. */
async function sourceFaces(url: string, start: number, end: number): Promise<(SrcFaces & { at: number }) | undefined> {
  const cfg = await getMotionConfig();
  if (!cfg) return undefined;
  const r = await fetch(`${cfg.api_url}/faces`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: cfg.secret, url, start, end }),
    signal: AbortSignal.timeout(100_000),
  }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (!j?.ok || !Array.isArray(j.faces)) return undefined;
  return { w: Number(j.w) || 0, h: Number(j.h) || 0, faces: j.faces.slice(0, 600), at: Date.now() };
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
  const meta = (job as any).metadata ?? {};
  let ref = (meta.previews ?? {})[key] as (PolishRef & { at?: number }) | undefined;
  if (ref && (!Array.isArray(ref.headlines) || (ref as { hv?: number }).hv !== HEADLINE_VERSION)) ref = undefined; // older headline logic: polish again
  let fx = (meta.preview_faces ?? {})[key] as (SrcFaces & { at?: number }) | undefined;
  const mediaUrl = String(meta.analysis?.media_url || "");
  const [newRef, newFx] = await Promise.all([
    b?.polish && !ref && words.length >= 8
      ? clipPolish(words.map((w, i) => ({ i, ...w })), end - start, String(b?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90), Date.now() + 50_000)
        .then(async (p) => {
          const headlines = await enrichHeadlines(p.headlines, String(b?.title ?? "")).catch(() => p.headlines);
          return { words: words.map((w) => w.w), keywords: p.keywords, zooms: p.zooms, headlines, hv: HEADLINE_VERSION, at: Date.now() };
        })
      : Promise.resolve(undefined),
    b?.faces && !fx && mediaUrl.startsWith("https://") ? sourceFaces(mediaUrl, start, end) : Promise.resolve(undefined),
  ]);
  if (newRef || newFx) {
    ref = newRef ?? ref;
    fx = newFx ?? fx;
    // kept on the analysis row (the newest 40 clips) — read fresh so a parallel preview isn't lost
    const { data: cur } = await admin.from("history").select("metadata").eq("id", jobId).maybeSingle();
    const m = (cur?.metadata as any) ?? {};
    const newest = <T extends { at?: number }>(all: Record<string, T>) =>
      Object.fromEntries(Object.entries(all).sort((x, y) => (y[1].at ?? 0) - (x[1].at ?? 0)).slice(0, 40));
    await admin.from("history").update({
      metadata: {
        ...m,
        ...(newRef ? { previews: newest({ ...(m.previews ?? {}), [key]: newRef }) } : {}),
        ...(newFx ? { preview_faces: newest({ ...(m.preview_faces ?? {}), [key]: newFx }) } : {}),
      },
    }).eq("id", jobId);
  }
  // the polish was made on these very words; a transcript read differently (rare) drops it rather than misplace it
  // an older cache (made before the headlines) is made again, so every clip gets them
  const fits = ref && ref.words.length === words.length && Array.isArray(ref.headlines);
  return NextResponse.json({
    ok: true, words, aligned,
    keywords: fits ? ref!.keywords : [], zooms: fits ? ref!.zooms : [], headlines: fits ? ref!.headlines : [], polished: !!fits,
    faces: fx ? { w: fx.w, h: fx.h, faces: fx.faces } : null, faced: !!fx,
  });
}
