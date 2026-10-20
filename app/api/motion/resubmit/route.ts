import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOTION_EDIT_MAX_SEC, asEngine, costFor, motionStart, newPlanToken, round2, siteUrl, type EditInput } from "@/lib/motion";
import { padatMin, startPadatEdit } from "@/lib/motion-padat";
import { priceFor, refundReserved, reserveCredit } from "@/lib/deduct";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { styleEnergy } from "@/lib/motion-styles";

// POST /api/motion/resubmit { id, product } — in-place re-render of a finished
// Edit Video job. The SAME History card turns back into a live placeholder and
// gets the new video (own file name — the first is cached immutable); if the
// re-render fails the card goes back to its previous video (and the credit
// held for it is refunded). Always charged like a new edit, to the job owner.
// The new video is rendered straight from the card's LATEST script (reviewed
// in step 2 / saved in the 📝 Skrip box) — no new transcript, no review. Jobs
// from before the 2-step flow have no script: they start again from the
// script + captions step (review, then "Jana Video").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Motion tidak dibuka untuk akaun ini." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: row }, { data: me }] = await Promise.all([
    admin.from("history").select("id, user_id, tab, status, cost, output_url, task_id, error_message, metadata").eq("id", id).maybeSingle(),
    admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!row || (row.user_id !== user.id && !me?.is_admin)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const oldInput = meta.input as EditInput | undefined;
  if (row.tab !== "motion" || meta.feature !== "motion-edit" || !oldInput?.videoUrl) {
    return NextResponse.json({ error: "Hanya video Edit Video boleh dihantar semula." }, { status: 400 });
  }
  // The product name (its correct spelling) is required — the director, the
  // caption fixer and the transcriber all lean on it.
  const product = String(b?.product ?? oldInput.product ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!product) return NextResponse.json({ error: "Sila isi nama produk dulu." }, { status: 400 });
  // Product photos (1–5): the ones sent from the Resubmit box (old ones whose
  // file is gone were dropped there and new ones uploaded / taped).
  const productImages = (Array.isArray(b?.product_images) ? b.product_images : oldInput.productImages ?? [])
    .map((u: unknown) => String(u ?? "").trim())
    .filter((u: string) => /^https:\/\/[^\s]+$/.test(u) && u.length <= 1000)
    .slice(0, 5);
  if (!productImages.length) return NextResponse.json({ error: "Upload sekurang-kurangnya 1 gambar produk." }, { status: 400 });
  // the engine can be switched at resubmit (Laju <-> Padat); default: the job's own
  const engine = b?.engine === undefined ? asEngine(oldInput.engine) : asEngine(b.engine);
  const input: EditInput = { ...oldInput, product, productImages, engine };
  // the latest script; an older draft's plan is dropped so the director plans afresh
  const { plan: _dp, ...script } = (meta.draft ?? {}) as Record<string, unknown>;
  void _dp;
  const fromScript = Array.isArray(script.words) && script.words.length > 0;
  // a finished job re-renders in place (a failed re-render restores its video);
  // a failed job just gets another go (a failed retry refunds and stays failed)
  if (row.status !== "done" && row.status !== "failed") {
    return NextResponse.json({ error: "Video ini masih diproses." }, { status: 409 });
  }
  const wasDone = row.status === "done";
  const done = Number(meta.resubmits) || 0;
  const rate = await priceFor(row.user_id, "motion", "motion");
  const minCost = engine === "padat" ? await padatMin(rate) : 0;
  const estimate = round2(Math.max(costFor(Math.min(Number(oldInput.durationSec) || 0, MOTION_EDIT_MAX_SEC), rate), minCost));

  // Back to pending with a fresh plan token; the old result is kept so a failed
  // re-render can restore it. Old guard / plan / render data is dropped so the
  // new run's report isn't mixed with the old one.
  const {
    guard: _g, plan: _p, render: _r, qa: _q, transcript: _t, poster_url: _pu, resubmit_error: _e,
    draft: _d, reviewed: _rv, review_at: _ra, render_started_at: _rs, padat_min: _pm, padat: _pd, ...rest
  } = meta;
  void _g; void _p; void _r; void _q; void _t; void _e; void _d; void _rv; void _ra; void _rs; void _pm; void _pd;
  const planToken = newPlanToken();
  const n = done + 1;
  if (estimate > 0 && !(await reserveCredit(row.user_id, "motion", estimate, id))) {
    return NextResponse.json(
      { error: `Kredit tidak mencukupi — perlu RM${estimate.toFixed(2)} untuk render semula.`, needed: estimate },
      { status: 402 },
    );
  }
  const refund = () => (estimate > 0 ? refundReserved(row.user_id, "motion", estimate, id) : Promise.resolve());
  const { data: flipped } = await admin
    .from("history")
    .update({
      status: "pending",
      error_message: null,
      // the old (finished) Modal call id must not be polled for this run
      task_id: null,
      metadata: {
        ...rest,
        input,
        stage: "queued",
        rate,
        reserved: estimate,
        plan_token: planToken,
        resubmits: n,
        resubmit_started_at: new Date().toISOString(),
        ...(minCost > 0 ? { padat_min: minCost } : {}),
        // render from the latest script, or (no script yet) the 2-step flow:
        // script + captions first (review), then "Jana Video"
        ...(fromScript ? { draft: script } : { review: true }),
        // this re-render's own file name
        out_suffix: `-r${n}`,
        resubmit_prev: wasDone && row.output_url
          ? { output_url: row.output_url, cost: row.cost, metadata: { guard: meta.guard, plan: meta.plan, render: meta.render, poster_url: _pu } }
          : null,
      },
    })
    .eq("id", id)
    .eq("status", row.status)
    .select("id");
  if (!flipped?.length) {
    await refund();
    return NextResponse.json({ error: "Video sedang diproses." }, { status: 409 });
  }

  // Padat with a script: Claude Code rebuilds it on HyperFrames in a fresh
  // workspace; otherwise the Laju renderer (or, no script yet, step 1 first)
  const padat = fromScript && engine === "padat";
  const start = padat
    ? await startPadatEdit({ id, userId: row.user_id, input, draft: script as Parameters<typeof startPadatEdit>[0]["draft"], step: `r${n}`, ws: `${id}-r${n}` })
    : await motionStart({
      flow: "edit",
      history_id: id,
      user_id: row.user_id,
      video_url: input.videoUrl,
      plan_url: `${siteUrl()}/api/motion/plan`,
      qa_url: `${siteUrl()}/api/motion/qa`,
      guard_url: `${siteUrl()}/api/motion/guard`,
      guard: !!input.guard,
      plan_token: planToken,
      style: styleEnergy(input.style),
      look: input.style,
      resolution: input.resolution,
      jumpcut: input.jumpcut,
      language: input.language,
      hint: product,
      music: input.music,
      sfx: input.sfx,
      max_sec: MOTION_EDIT_MAX_SEC,
      auto: !!input.auto,
      captions: input.captions,
      ...(fromScript ? { phase: "render", draft: script, out_suffix: `-r${n}` } : { phase: "draft" }),
    });
  if (!start.ok) {
    // restore the card exactly as it was
    await admin.from("history").update({ status: row.status, task_id: row.task_id, error_message: row.error_message, metadata: meta }).eq("id", id);
    await refund();
    return NextResponse.json({ error: `Gagal mula render: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), provider: padat ? "modal-vgc" : "modal-motion" } }).eq("id", id);
  return NextResponse.json({ ok: true });
}
