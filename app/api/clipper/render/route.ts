import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { priceFor, refundReserved, reserveCredit } from "@/lib/deduct";
import { costFor, motionStart, newPlanToken, round2, siteUrl, type EditInput } from "@/lib/motion";
import { LOCK_CAPTION_LOOKS } from "@/lib/motion-manual";
import { CLIPPER_JOB_TAB, CLIPPER_TAB, clipperYoutubeAuth, type ClipperAnalysis } from "@/lib/clipper";
import { clipFlash, clipKey, clipSeed, type PolishRef } from "@/lib/clipper-preview";

// POST /api/clipper/render { job_id, clips: [{start, end, title, hook}], settings, project_id? } — CLIPPER step 2:
// every chosen clip becomes a History row (tab "clipper") rendered by the Motion engine (modal_motion.py flow
// "clip"): segment → 9:16 reframe around the speaker → captions + hook ("Klip + caption" is the only mode).
// Charged like a Motion edit: the clip's seconds × the Motion rate (held now, trued up on the real length).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_CLIPS = 20;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "clipper"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const jobId = String(b?.job_id || "");
  const admin = createAdminClient();
  const { data: job } = await admin.from("history").select("id, user_id, status, metadata, project_id").eq("id", jobId).maybeSingle();
  if (!job || job.user_id !== user.id || (job as any).metadata?.feature !== "clipper-analysis") {
    return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
  }
  const a = (job as any).metadata?.analysis as ClipperAnalysis | undefined;
  const src = (job as any).metadata?.source as { type: string; url: string; name?: string } | undefined;
  if (job.status !== "done" || !a || !src) return NextResponse.json({ error: "Analisa belum siap." }, { status: 409 });

  // settings
  const s = b?.settings ?? {};
  // CLIPPER renders "Klip + caption" only (2026-10-22) — an old client asking for "auto" / "style" gets captions too
  const mode = "captions" as const;
  const frame = ["face", "fit", "center", "split"].includes(s.frame) ? s.frame : "face";
  const captions = s.captions !== false;
  const captionLook = LOCK_CAPTION_LOOKS.some((c) => c.id === s.captionLook) ? String(s.captionLook) : undefined;
  const captionPos = s.captionPos === "mid" ? "mid" : "low";
  const hookOn = s.hook !== false;
  const music = s.music === true;
  const sfx = s.sfx !== false;
  const jumpcut = s.jumpcut !== false; // long pauses inside the clip shortened
  const coldOpen = s.coldOpen !== false; // the clip's punchline teased first, when the director marked one
  const polish = s.polish !== false; // captions mode: keyword colours, emoji, punch-ins, progress bar
  const wmText = String(s.watermark?.text ?? "").replace(/[^\w@.\- ]/g, "").trim().slice(0, 40);
  const wmImage = /^https:\/\/[^\s]+$/.test(String(s.watermark?.image ?? "")) ? String(s.watermark.image).slice(0, 1000) : "";
  const language = (["ms", "en", "id"].includes(String(a.language)) ? a.language : "ms") as "ms" | "en" | "id";
  // what the Studio preview made per clip (keyword colours / zooms) — the render reuses it, so it looks the same
  const previews = ((job as any).metadata?.previews ?? {}) as Record<string, PolishRef & { at?: number }>;

  // the analysis' speaker turns [[s, e, "S1"], …] (source seconds) → one clip's, in clip seconds
  const turnsIn = (all: unknown, s: number, e: number) =>
    (Array.isArray(all) ? all : [])
      .filter((t: any) => Array.isArray(t) && Number(t[1]) > s && Number(t[0]) < e)
      .map((t: any) => ({ s: Math.round(Math.max(0, Number(t[0]) - s) * 100) / 100, e: Math.round((Math.min(e, Number(t[1])) - s) * 100) / 100, spk: String(t[2]) }))
      .slice(0, 400);

  // the clips
  const dur = Number(a.duration) || 0;
  const clips = (Array.isArray(b?.clips) ? b.clips : []).slice(0, MAX_CLIPS).map((c: any) => {
    const start = Math.max(0, Number(c?.start) || 0);
    const end = Math.min(dur || Infinity, Number(c?.end) || 0);
    // the cold open must sit inside the (possibly nudged) clip, past its opening (the preview applies the same rule)
    const flash = clipFlash({ start, end, flash: c?.flash }, coldOpen);
    return {
      start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100,
      title: String(c?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90) || "Klip",
      hook: String(c?.hook ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      flash,
    };
  }).filter((c: { start: number; end: number }) => c.end - c.start >= 3 && c.end - c.start <= 120);
  if (!clips.length) return NextResponse.json({ error: "Pilih sekurang-kurangnya satu klip (3–120 saat)." }, { status: 400 });

  const rate = await priceFor(user.id, "motion", "motion");
  const ytAuth = src.type === "youtube" ? await clipperYoutubeAuth() : null;
  const projectId = typeof b?.project_id === "string" && /^[0-9a-f-]{36}$/i.test(b.project_id) ? b.project_id : job.project_id ?? null;
  const ids: string[] = [];
  const failed: string[] = [];
  let total = 0;
  // 1) rows + credit for every clip at once (the charge is one atomic call per clip, so running out of credit just
  //    leaves the clips it can't cover; the rest still go)
  type Prepared = { c: (typeof clips)[number]; rowId: string; estimate: number; input: EditInput; planToken: string };
  let short: number | null = null;
  let skipped = 0; // clips the credit didn't cover
  const ready = await Promise.all(clips.map(async (c: (typeof clips)[number]): Promise<Prepared | null> => {
    const len = c.end - c.start;
    const estimate = round2(costFor(len, rate));
    const planToken = newPlanToken();
    const seed = clipSeed(job.id, c.start, c.end);
    const ref = polish ? previews[clipKey(c.start, c.end)] : undefined;
    const input: EditInput = {
      videoUrl: src.type === "youtube" ? src.url : String(a.media_url || src.url),
      durationSec: len,
      language: language === "id" ? "auto" : language,
      // the director's context: the source video + this clip
      product: `${(a.title || "Video").slice(0, 60)} — ${c.title}`.slice(0, 120),
      productImages: [],
      captions,
      captionStyle: "pop",
      captionPos,
      music,
      sfx,
      style: "gempak",
      resolution: "1080",
      jumpcut: false,
      broll: false,
      facts: false,
      guard: false,
      auto: true,
      ...(captionLook ? { locks: { captionLook: captionLook as any } } : {}),
      engine: "laju",
      clip: { mode, title: c.title, ...(hookOn && c.hook ? { hook: c.hook } : {}), job_id: job.id, start: c.start, end: c.end,
        ...(c.flash ? { flash: c.flash } : {}), polish, seed,
        ...(ref?.words?.length ? { polish_ref: { words: ref.words, keywords: ref.keywords ?? [], zooms: ref.zooms ?? [] } } : {}) },
    };
    const { data: row, error } = await admin.from("history").insert({
      user_id: user.id,
      project_id: projectId,
      type: "video",
      tab: CLIPPER_TAB,
      status: "pending",
      prompt: c.title,
      reference_url: src.url,
      task_id: null,
      cost: estimate,
      duration: Math.round(len),
      metadata: {
        feature: "motion-edit", model: "clipper", stage: "queued", rate, reserved: estimate, input, plan_token: planToken, aspectRatio: "9:16",
        renderer: "hyperframes",
        clipper: { job_id: job.id, start: c.start, end: c.end, title: c.title, hook: c.hook, mode, frame, source_title: a.title ?? null },
      },
    }).select("id").single();
    if (error || !row) { failed.push(c.title); return null; }
    if (!(await reserveCredit(user.id, "motion", estimate, row.id))) {
      await admin.from("history").delete().eq("id", row.id);
      short = short === null ? estimate : Math.min(short, estimate);
      skipped++;
      return null;
    }
    return { c, rowId: row.id, estimate, input, planToken };
  }));
  const prepared = ready.filter((x): x is Prepared => !!x);
  if (!prepared.length && short !== null) {
    return NextResponse.json({ error: `Kredit tidak mencukupi — perlu sekurang-kurangnya RM${(short as number).toFixed(2)} untuk satu klip.`, ids, needed: short }, { status: 402 });
  }
  // 2) every clip starts at once — each is its own Modal job, so they render in parallel
  await Promise.all(prepared.map(async ({ c, rowId, estimate, input, planToken }) => {
    const start = await motionStart({
      flow: "clip",
      renderer: "hyperframes",
      history_id: rowId,
      user_id: user.id,
      video_url: input.videoUrl,
      plan_url: `${siteUrl()}/api/motion/plan`,
      qa_url: `${siteUrl()}/api/motion/qa`,
      guard_url: `${siteUrl()}/api/motion/guard`,
      guard: false,
      plan_token: planToken,
      style: "gempak",
      look: "gempak",
      resolution: "1080",
      jumpcut: false,
      language: input.language,
      hint: (a.title || "").slice(0, 120),
      music,
      sfx,
      max_sec: 125,
      auto: true,
      captions,
      ...(ytAuth ? { yt_auth: ytAuth } : {}),
      clip: {
        source_type: src.type, url: src.url, media_url: a.media_url || null, start: c.start, end: c.end, frame, language, jumpcut,
        seed: clipSeed(job.id, c.start, c.end),
        ...(c.flash ? { flash: c.flash } : {}),
        // who speaks when inside this clip (clip seconds) — the camera cuts on speaker turns
        turns: turnsIn(a.turns, c.start, c.end),
        ...(wmText || wmImage ? { watermark: { ...(wmText ? { text: wmText } : {}), ...(wmImage ? { image: wmImage } : {}) } } : {}),
      },
    });
    if (!start.ok) {
      await admin.from("history").update({ status: "failed", error_message: `Gagal mula render: ${start.error}`, cost: 0 }).eq("id", rowId);
      await refundReserved(user.id, "motion", estimate, rowId);
      failed.push(c.title);
      return;
    }
    const { data: cur } = await admin.from("history").select("metadata").eq("id", rowId).maybeSingle();
    await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), stage: "queued", provider: "modal-motion" } }).eq("id", rowId);
    ids.push(rowId);
    total += estimate;
  }));
  if (!ids.length) return NextResponse.json({ error: `Gagal mula render${failed.length ? `: ${failed.join(", ")}` : ""}.` }, { status: 502 });
  return NextResponse.json({ ok: true, ids, estimate: round2(total), failed,
    ...(skipped > 0 ? { skipped, notice: `Kredit tidak cukup untuk ${skipped} klip lagi — yang lain sedang dijana.` } : {}) });
}
