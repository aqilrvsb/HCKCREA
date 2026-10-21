import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches, type EditInput } from "@/lib/motion";
import { directEdit, directionSummary, type ProDirection } from "@/lib/motion-director";
import { getSetting } from "@/lib/settings";
import { fixTranscript } from "@/lib/motion-captions";
import { withDeadline } from "@/lib/openrouter";
import { HOOK_SOUND_COUNT } from "@/lib/motion-hook-sounds";

/** CLIPPER "captions" mode: the clip with its hook title and creator captions — no AI edit plan (no stickers,
 *  scenes or B-roll), so it renders fast and stays true to the source. */
function clipCaptionPlan(input: EditInput) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
  const look = input.locks?.captionLook && input.locks.captionLook !== "tiktok" ? input.locks.captionLook : pick(["hormozi", "karaoke", "beast", "popline", "fill", "sweep"]);
  return {
    hook: input.clip?.hook ? { text: input.clip.hook } : null,
    accent: "#FFD93B",
    mood: "upbeat" as const,
    captions: { on: input.captions !== false, style: input.locks?.captionLook === "tiktok" ? "tiktok" : "pop", pos: input.captionPos ?? "low", maxWords: 3 },
    overlays: [], zooms: [], broll: [], facts: [], keywords: [],
    music: !!input.music,
    energy: "gempak",
    ...(input.sfx && input.clip?.hook ? { hookSound: Math.floor(Math.random() * HOOK_SOUND_COUNT) } : {}),
    direction: {
      caption_look: look, hook_style: pick(["headline", "slam", "blocks"]), font: pick(["montserrat", "archivo", "anton"]),
      end_card: "none", progress: "none", fx: "light", captions: "big", camera: "calm",
    },
    director: "clipper-captions",
  };
}

// POST /api/motion/plan — called BY the Modal Edit Video job once it has the
// (jump-cut) transcript. Auth = the per-row plan_token minted at submit (only
// Modal has it). Runs the director (model_motion cascade) + Serper Google
// image/fact grounding here, so admin's provider/fallback/search settings
// apply, and returns the full edit plan for the render.
//   mode "fixes" — 2-step flow, step 1: caption spelling fixes only (fast)
//   mode "plan"  — step 2: the director only (the words were fixed in step 1
//                  and reviewed by the client)
//   no mode      — both, side by side (one-shot render)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
// Leaves room for the history update + response inside maxDuration (and
// under Modal's 290 s request timeout).
const PLAN_BUDGET_MS = 265_000;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.history_id || "");
  const token = String(b?.token || "");
  if (!id || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, user_id, tab, status, metadata").eq("id", id).maybeSingle();
  // Motion edits, and CLIPPER clips (rendered by the same pipeline)
  if (!row || (row.tab !== "motion" && row.tab !== "clipper") || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "row not pending" }, { status: 409 });

  const duration = Math.max(0.5, Number(b?.duration) || 0);
  const words = (Array.isArray(b?.words) ? b.words : [])
    .slice(0, 3000)
    .map((w: any, i: number) => ({ i, w: String(w?.w ?? "").slice(0, 40), t: Number(w?.t) || 0, e: Number(w?.e) || undefined }))
    .filter((w: any) => w.w);

  const t0 = Date.now();
  const mode = b?.mode === "fixes" || b?.mode === "plan" ? b.mode : "both";
  const input = row.metadata?.input as EditInput;
  if (mode === "fixes") {
    const fixes = await withDeadline(t0 + PLAN_BUDGET_MS, () =>
      fixTranscript(words.map((w: { i: number; w: string }) => ({ i: w.i, w: w.w })), input?.product || undefined, input?.language)).catch(() => [] as [number, string][]);
    const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
    await admin.from("history").update({ metadata: { ...(cur?.metadata || {}), caption_fixes: fixes.slice(0, 40) } }).eq("id", id);
    return NextResponse.json({ ok: true, fixes });
  }
  // CLIPPER "captions" mode: no director — the clip, its hook and the captions
  if (input?.clip?.mode === "captions") {
    const plan = clipCaptionPlan(input);
    const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
    await admin.from("history").update({
      metadata: { ...(cur?.metadata || {}), stage: "render", plan: { hook: plan.hook, words: words.length, director: plan.director, direction: plan.direction, ms: Date.now() - t0 } },
    }).eq("id", id);
    return NextResponse.json({ ok: true, plan: { ...plan, fixes: [] } });
  }
  // Caption spelling fixes are returned even when the director fails, so the
  // captions-only fallback still reads in the video's language.
  let fixing: Promise<[number, string][]> = Promise.resolve([]);
  try {
    const context = input?.product || undefined;
    // Director + caption spelling clean-up run side by side (no added wait).
    // Every AI call inside honours PLAN_BUDGET_MS, so a slow provider ends in a
    // leaner plan — never in Vercel killing the request (Modal would then fall
    // back to captions only).
    if (mode === "both") {
      fixing = withDeadline(t0 + PLAN_BUDGET_MS, () =>
        fixTranscript(words.map((w: any) => ({ i: w.i, w: w.w })), context, input?.language)).catch(() => [] as [number, string][]);
    }
    // Rendered on HyperFrames (the admin switch, or a job that asked for it): the director also
    // decides the PRO finish, told what this client's last edits looked like so this one differs
    const rendererSetting = await getSetting<{ renderer?: string }>("motion_renderer").catch(() => null);
    const pro = b?.renderer === "hyperframes" || row.metadata?.renderer === "hyperframes" || rendererSetting?.renderer === "hyperframes";
    let recent: string[] = [];
    if (pro && row.user_id) {
      const { data: past } = await admin.from("history").select("metadata->plan->direction")
        .eq("user_id", row.user_id).eq("tab", "motion").neq("id", id).order("created_at", { ascending: false }).limit(12);
      recent = (past ?? []).map((r: any) => directionSummary(r?.direction as ProDirection)).filter((x): x is string => !!x).slice(0, 5);
    }
    const [plan, fixes] = await withDeadline(t0 + PLAN_BUDGET_MS, () => Promise.all([
      directEdit({ words, duration, input, hasFace: b?.has_face !== false, pro, recent }),
      fixing,
    ]));
    const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
    await admin
      .from("history")
      .update({
        metadata: {
          ...(cur?.metadata || {}),
          stage: "render",
          plan: {
            hook: plan.hook, overlays: plan.overlays.length, zooms: plan.zooms.length, broll: plan.broll.length,
            facts: plan.facts.map((f) => `${f.text} (${f.source})`), keywords: plan.keywords.length,
            rehook: plan.rehook?.text ?? null, cta: plan.cta?.text ?? null, words: words.length, ms: Date.now() - t0,
            ...(plan.guard ? { guard: plan.guard } : {}),
            brand: plan.brand ?? null,
            broll_src: plan.broll.map((b) => { try { return new URL(b.candidates[0]).hostname; } catch { return null; } }),
            broll_kinds: plan.broll.map((b) => b.kind ?? "photo"),
            stickers: plan.overlays.filter((o) => o.t === "gif").map((o) => (o.src ? "giphy" : "emoji-fallback")),
            caption_fixes: (mode === "plan" ? cur?.metadata?.caption_fixes ?? [] : fixes).slice(0, 40),
            uploads: input?.productImages?.length ?? 0,
            director: plan.director ?? null, // which provider/model wrote the plan
            ...(plan.direction ? { direction: plan.direction } : {}), // the PRO finish it chose (HyperFrames)
            // AI Auto: what the director chose for this video (admin monitor)
            ...(plan.look ? {
              look: plan.look, angle: plan.angle ?? null, hook_sound: plan.hookSound ?? null, music: plan.music ?? null,
              mood: plan.mood, captions: plan.captions.style, accent: plan.accent,
            } : {}),
          },
          transcript: words.map((w: any) => w.w).join(" ").slice(0, 4000),
        },
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, plan: { ...plan, fixes } });
  } catch (e: any) {
    // Modal falls back to captions-only when the plan fails — still with the
    // caption fixes (that call is bounded by the same deadline).
    const fixes = await fixing.catch(() => [] as [number, string][]);
    return NextResponse.json({ ok: false, error: e?.message || "plan failed", fixes }, { status: 502 });
  }
}
