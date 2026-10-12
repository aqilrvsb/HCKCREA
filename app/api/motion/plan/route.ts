import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches, type EditInput } from "@/lib/motion";
import { directEdit } from "@/lib/motion-director";
import { fixTranscript } from "@/lib/motion-captions";
import { withDeadline } from "@/lib/openrouter";

// POST /api/motion/plan — called BY the Modal Edit Video job once it has the
// (jump-cut) transcript. Auth = the per-row plan_token minted at submit (only
// Modal has it). Runs the director (model_motion cascade) + Serper Google
// image/fact grounding here, so admin's provider/fallback/search settings
// apply, and returns the full edit plan for the render.
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
  const { data: row } = await admin.from("history").select("id, tab, status, metadata").eq("id", id).maybeSingle();
  if (!row || row.tab !== "motion" || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "row not pending" }, { status: 409 });

  const duration = Math.max(0.5, Number(b?.duration) || 0);
  const words = (Array.isArray(b?.words) ? b.words : [])
    .slice(0, 3000)
    .map((w: any, i: number) => ({ i, w: String(w?.w ?? "").slice(0, 40), t: Number(w?.t) || 0, e: Number(w?.e) || undefined }))
    .filter((w: any) => w.w);

  const t0 = Date.now();
  // Caption spelling fixes are returned even when the director fails, so the
  // captions-only fallback still reads in the video's language.
  let fixing: Promise<[number, string][]> = Promise.resolve([]);
  try {
    const input = row.metadata?.input as EditInput;
    const context = input?.product || undefined;
    // Director + caption spelling clean-up run side by side (no added wait).
    // Every AI call inside honours PLAN_BUDGET_MS, so a slow provider ends in a
    // leaner plan — never in Vercel killing the request (Modal would then fall
    // back to captions only).
    fixing = withDeadline(t0 + PLAN_BUDGET_MS, () =>
      fixTranscript(words.map((w: any) => ({ i: w.i, w: w.w })), context, input?.language)).catch(() => [] as [number, string][]);
    const [plan, fixes] = await withDeadline(t0 + PLAN_BUDGET_MS, () => Promise.all([
      directEdit({ words, duration, input, hasFace: b?.has_face !== false }),
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
            caption_fixes: fixes.slice(0, 40),
            uploads: input?.productImages?.length ?? 0,
            director: plan.director ?? null, // which provider/model wrote the plan
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
