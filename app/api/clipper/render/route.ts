import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { priceFor, refundReserved, reserveCredit } from "@/lib/deduct";
import { costFor, motionStart, newPlanToken, round2, siteUrl, type EditInput } from "@/lib/motion";
import { LOCK_CAPTION_LOOKS } from "@/lib/motion-manual";
import { vgcStyle } from "@/lib/vgc-styles";
import { CLIPPER_JOB_TAB, CLIPPER_TAB, clipperYoutubeAuth, type ClipperAnalysis } from "@/lib/clipper";

// POST /api/clipper/render { job_id, clips: [{start, end, title, hook}], settings, project_id? } — CLIPPER step 2:
// every chosen clip becomes a History row (tab "clipper") rendered by the Motion engine (modal_motion.py flow
// "clip"): segment → 9:16 reframe around the speaker → captions + hook, or the full AI edit (AI Auto / a style).
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
  const mode: "captions" | "auto" | "style" = s.mode === "auto" || s.mode === "style" ? s.mode : "captions";
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
  let styleId: string | undefined, styleName: string | undefined;
  if (mode === "style") {
    const st = await vgcStyle(String(s.styleId || ""));
    if (!st) return NextResponse.json({ error: "Pilih satu style dulu." }, { status: 400 });
    styleId = st.id;
    styleName = st.name;
  }
  const language = (["ms", "en", "id"].includes(String(a.language)) ? a.language : "ms") as "ms" | "en" | "id";

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
    // the cold open must sit inside the (possibly nudged) clip, past its opening
    const fs0 = Number(c?.flash?.start), fe0 = Number(c?.flash?.end);
    const flash = coldOpen && Number.isFinite(fs0) && Number.isFinite(fe0) && fs0 >= start + 2 && fe0 <= end + 0.5 && fe0 - fs0 >= 0.8
      ? { start: Math.round(fs0 * 100) / 100, end: Math.round(Math.min(fe0, fs0 + 3.2) * 100) / 100 } : null;
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
  // 1) rows + credit, one by one (quick DB calls); credit running out stops here — the clips already prepared still go
  type Prepared = { c: (typeof clips)[number]; rowId: string; estimate: number; input: EditInput; planToken: string };
  const prepared: Prepared[] = [];
  let short: number | null = null;
  for (const c of clips) {
    const len = c.end - c.start;
    const estimate = round2(costFor(len, rate));
    const planToken = newPlanToken();
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
      broll: mode !== "captions",
      facts: false,
      guard: false,
      auto: true,
      ...(styleId || captionLook ? { locks: { ...(styleId ? { styleId, styleName } : {}), ...(captionLook ? { captionLook: captionLook as any } : {}) } } : {}),
      engine: "laju",
      clip: { mode, title: c.title, ...(hookOn && c.hook ? { hook: c.hook } : {}), job_id: job.id, start: c.start, end: c.end,
        ...(c.flash ? { flash: c.flash } : {}), ...(mode === "captions" ? { polish } : {}) },
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
    if (error || !row) { failed.push(c.title); continue; }
    if (!(await reserveCredit(user.id, "motion", estimate, row.id))) {
      await admin.from("history").delete().eq("id", row.id);
      short = estimate;
      break;
    }
    prepared.push({ c, rowId: row.id, estimate, input, planToken });
  }
  if (!prepared.length && short !== null) {
    return NextResponse.json({ error: `Kredit tidak mencukupi — perlu RM${short.toFixed(2)} untuk klip pertama.`, ids, needed: short }, { status: 402 });
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
  const skipped = clips.length - prepared.length;
  return NextResponse.json({ ok: true, ids, estimate: round2(total), failed,
    ...(skipped > 0 ? { skipped, notice: `Kredit tidak cukup untuk ${skipped} klip lagi — yang lain sedang dijana.` } : {}) });
}
