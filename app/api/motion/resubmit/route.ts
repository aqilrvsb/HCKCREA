import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOTION_EDIT_MAX_SEC, motionStart, newPlanToken, siteUrl, type EditInput } from "@/lib/motion";
import { motionGuardTouched } from "@/lib/motion-guard-summary";
import { styleEnergy } from "@/lib/motion-styles";

// POST /api/motion/resubmit { id } — free, in-place re-render of a finished
// Edit Video job that the old guideline mode spoiled (taped / muted / cut).
// The SAME History card turns back into a live placeholder and gets the new
// video (own file name — the first is cached immutable); nothing is charged
// (rate 0), the card keeps what was paid the first time, and if the
// re-render fails the card goes back to its previous video. Once per job.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESUBMITS = 1;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: row }, { data: me }] = await Promise.all([
    admin.from("history").select("id, user_id, tab, status, cost, output_url, task_id, metadata").eq("id", id).maybeSingle(),
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
  const input: EditInput = { ...oldInput, product };
  if (row.status !== "done") return NextResponse.json({ error: "Video ini belum siap." }, { status: 409 });
  const done = Number(meta.resubmits) || 0;
  if (done >= MAX_RESUBMITS) return NextResponse.json({ error: "Video ini sudah dihantar semula." }, { status: 409 });
  if (!motionGuardTouched(meta.guard)) {
    return NextResponse.json({ error: "Video ini tidak ditampal / di-mute — tiada perlu hantar semula." }, { status: 400 });
  }

  // Back to pending with a fresh plan token; the old result is kept so a failed
  // re-render can restore it. Old guard / plan / render data is dropped so the
  // new run's report isn't mixed with the old one.
  const { guard: _g, plan: _p, render: _r, qa: _q, transcript: _t, poster_url: _pu, ...rest } = meta;
  void _g; void _p; void _r; void _q; void _t;
  const planToken = newPlanToken();
  const n = done + 1;
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
        rate: 0,
        reserved: 0,
        plan_token: planToken,
        resubmits: n,
        resubmit_started_at: new Date().toISOString(),
        resubmit_prev: { output_url: row.output_url, cost: row.cost, metadata: { guard: meta.guard, plan: meta.plan, render: meta.render, poster_url: _pu } },
      },
    })
    .eq("id", id)
    .eq("status", "done")
    .select("id");
  if (!flipped?.length) return NextResponse.json({ error: "Video sedang diproses." }, { status: 409 });

  const start = await motionStart({
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
    out_suffix: `-r${n}`,
  });
  if (!start.ok) {
    // restore the card exactly as it was
    await admin.from("history").update({ status: "done", task_id: row.task_id, metadata: meta }).eq("id", id);
    return NextResponse.json({ error: `Gagal mula render: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), provider: "modal-motion" } }).eq("id", id);
  return NextResponse.json({ ok: true });
}
