import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOTION_EDIT_MAX_SEC, motionStart, siteUrl, type EditInput } from "@/lib/motion";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { styleEnergy } from "@/lib/motion-styles";
import { startPadatEdit } from "@/lib/motion-padat";
import { startCustomEdit } from "@/lib/motion-custom";
import { applyDraftEdits, type DraftEdits, type DraftPlan, type DraftWord } from "@/lib/motion-review";

// POST /api/motion/render { id, edits } — step 2 of the Edit Video 2-step
// flow. The job is in "review" (step 1 stopped after the script + captions);
// the client's caption corrections are applied to the stored words, then
// Modal cuts the video, the AI director plans the edit on those words and it
// renders — same History card, back to a live placeholder. The credit held at
// step 1 pays for it (trued up to the real length when it settles).
// (Drafts made before step 1 was slimmed down also carry the cut video and
// the plan; their hook / sticker / re-hook / CTA edits still apply.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asMap = (v: unknown, max: number): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, s] of Object.entries(v as Record<string, unknown>).slice(0, 2000)) {
      if (/^\d{1,4}$/.test(k) && typeof s === "string") out[k] = s.slice(0, max);
    }
  }
  return out;
};

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
    admin.from("history").select("id, user_id, tab, status, metadata").eq("id", id).maybeSingle(),
    admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!row || (row.user_id !== user.id && !me?.is_admin)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const input = meta.input as EditInput | undefined;
  const draft = meta.draft as { words?: DraftWord[]; plan?: Record<string, unknown>; video_url?: string } | undefined;
  if (row.tab !== "motion" || meta.feature !== "motion-edit" || !input?.videoUrl || !draft || !Array.isArray(draft.words)) {
    return NextResponse.json({ error: "Skrip untuk video ini tidak dijumpai." }, { status: 400 });
  }
  if (row.status !== "review") return NextResponse.json({ error: "Video ini sudah diproses." }, { status: 409 });

  // the client's corrections → the words + plan the render uses
  const e = (b?.edits ?? {}) as Record<string, unknown>;
  const hook = e.hook as Record<string, unknown> | undefined;
  const cta = e.cta as Record<string, unknown> | undefined;
  const overlays: DraftEdits["overlays"] = {};
  if (e.overlays && typeof e.overlays === "object") {
    for (const [k, v] of Object.entries(e.overlays as Record<string, unknown>).slice(0, 200)) {
      const o = v as Record<string, unknown> | null;
      if (/^\d{1,3}$/.test(k) && o && typeof o === "object") {
        overlays[k] = { ...(typeof o.text === "string" ? { text: o.text } : {}), ...(typeof o.sub === "string" ? { sub: o.sub } : {}) };
      }
    }
  }
  const edits: DraftEdits = {
    lines: asMap(e.lines, 400),
    ...(hook ? { hook: { text: typeof hook.text === "string" ? hook.text : undefined, sub: typeof hook.sub === "string" ? hook.sub : undefined } } : {}),
    ...(typeof e.rehook === "string" ? { rehook: e.rehook } : {}),
    ...(cta ? { cta: { text: typeof cta.text === "string" ? cta.text : undefined, sub: typeof cta.sub === "string" ? cta.sub : undefined } } : {}),
    overlays,
  };
  const reviewed = applyDraftEdits({ words: draft.words, plan: (draft.plan ?? {}) as DraftPlan }, edits);
  // the client's own headline overlays (words and / or their B-roll from our storage), slot by slot
  const OWN_MEDIA = /^https:\/\/peninglab-content\.s3\.[a-z0-9-]+\.backblazeb2\.com\/(clipper-uploads|motion-images|motion-uploads)\/[^\s?#]+$/;
  const tx = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/[<>{}]/g, "").trim().slice(0, n) : "");
  const headlineFix = (Array.isArray(e.headlines) ? e.headlines : []).slice(0, 6)
    .map((x: any) => ({
      i: Number(x?.i), ...(tx(x?.lead, 34) ? { lead: tx(x.lead, 34) } : {}), ...(tx(x?.big, 18) ? { big: tx(x.big, 18) } : {}),
      ...(tx(x?.box, 34) ? { box: tx(x.box, 34) } : {}), ...(OWN_MEDIA.test(String(x?.url || "")) ? { url: String(x.url), video: !!x.video } : {}),
    }))
    .filter((x: { i: number; lead?: string; big?: string; box?: string; url?: string }) => Number.isInteger(x.i) && x.i >= 0 && x.i < 6 && (x.lead || x.big || x.box || x.url));
  // the reviewed words become the card's latest script (📝 Skrip box, Resubmit)
  const latest = { ...draft, words: reviewed.words, ...(draft.plan ? { plan: reviewed.plan } : {}) };

  // review → pending (same card, live placeholder again)
  const { data: flipped } = await admin
    .from("history")
    .update({
      status: "pending",
      error_message: null,
      task_id: null,
      metadata: {
        ...meta, stage: "queued", draft: latest,
        ...(headlineFix.length ? { input: { ...(meta.input ?? {}), headlineFix } } : {}),
        render_started_at: new Date().toISOString(), reviewed: { edits, at: new Date().toISOString() },
      },
    })
    .eq("id", id)
    .eq("status", "review")
    .select("id");
  if (!flipped?.length) return NextResponse.json({ error: "Video ini sedang diproses." }, { status: 409 });

  // Padat: Claude Code builds it on HyperFrames from the reviewed cut + words
  // (a resubmitted job renders to its own file name and a fresh workspace)
  const suffix = typeof meta.out_suffix === "string" ? meta.out_suffix : "";
  // Custom Style · Edit Footage Sendiri: the VGC build (Sonnet 5.5) from the client's prompt + this approved script
  const padat = input.engine === "padat";
  const custom = input.engine === "custom";
  const vgcRun = { id, userId: row.user_id, input, draft: latest, step: suffix ? suffix.replace(/^-/, "") : "v1", ws: id + suffix };
  const start = custom
    ? await startCustomEdit(vgcRun)
    : padat
    ? await startPadatEdit(vgcRun)
    : await motionStart({
      flow: "edit",
      phase: "render",
      history_id: id,
      user_id: row.user_id,
      draft: latest,
      video_url: input.videoUrl,
      plan_url: `${siteUrl()}/api/motion/plan`,
      qa_url: `${siteUrl()}/api/motion/qa`,
      guard_url: `${siteUrl()}/api/motion/guard`,
      guard: !!input.guard,
      plan_token: meta.plan_token,
      style: styleEnergy(input.style),
      look: input.style,
      resolution: input.resolution,
      jumpcut: input.jumpcut,
      language: input.language,
      hint: input.product?.slice(0, 120),
      music: input.music,
      sfx: input.sfx,
      max_sec: MOTION_EDIT_MAX_SEC,
      auto: !!input.auto,
      captions: input.captions,
      // a resubmitted job renders to its own file name ("-r1"…)
      ...(suffix ? { out_suffix: suffix } : {}),
    });
  if (!start.ok) {
    await admin.from("history").update({ status: "review", metadata: meta }).eq("id", id);
    return NextResponse.json({ error: `Gagal mula render: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), provider: padat || custom ? "modal-vgc" : "modal-motion" } }).eq("id", id);
  return NextResponse.json({ ok: true });
}
