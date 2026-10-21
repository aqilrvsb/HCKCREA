import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { refundReserved, reserveCredit } from "@/lib/deduct";
import { MOTION_EDIT_MAX_SEC, MOTION_VOICES, motionStart, newPlanToken, siteUrl, vgcStart, type EditInput } from "@/lib/motion";
import { customDirectorPlaybook } from "@/lib/motion-director";
import { vgcFlow, vgcPricing, vgcStepRendersVideo, type VgcMeta } from "@/lib/vgc";

// POST /api/vgc/start — Motion "Custom Style": run one VGC vault step directly.
// { prompt, step_id, title, project_id?, materials?: [{ url, name }], card_id?, voice? }
// A new History card per project; card_id = the next step of that project's
// flow (same Modal workspace + Claude Code session). Charged per run
// (app_settings.vgc_pricing), held now, refunded if the run fails.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATERIAL_HOST = /^https:\/\/[a-z0-9.-]+\.backblazeb2\.com\//i;

// GET → the per-run prices shown under the vault's Jana button
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await createAdminClient().from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  return NextResponse.json({
    pricing: me?.is_admin ? { video: 0, text: 0 } : await vgcPricing(),
    voices: MOTION_VOICES.map((v) => ({ key: v.key, label: v.label, gender: v.gender })),
  });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Motion tidak dibuka untuk akaun ini." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const prompt = String(b?.prompt ?? "").replace(/​/g, "").trim().slice(0, 40_000);
  const stepId = String(b?.step_id ?? "");
  const title = String(b?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const flow = vgcFlow(stepId);
  if (!flow || prompt.length < 50) return NextResponse.json({ error: "Prompt tidak lengkap." }, { status: 400 });
  const materials = (Array.isArray(b?.materials) ? b.materials : [])
    .map((m: unknown) => m as { url?: unknown; name?: unknown })
    .filter((m: { url?: unknown }) => typeof m?.url === "string" && MATERIAL_HOST.test(m.url as string))
    .slice(0, 20)
    .map((m: { url?: unknown; name?: unknown }) => ({ url: String(m.url), name: String(m.name || "").slice(0, 80) }));
  const video = vgcStepRendersVideo(stepId, title);
  // AI voice-over (Mira, Afifah…): the client's choice is the permission the
  // vault's "no paid TTS without permission" rule asks for
  const voiceKey = String(b?.voice ?? "").toLowerCase();
  const voice = MOTION_VOICES.find((v) => v.key === voiceKey) ?? null;

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  const pricing = await vgcPricing();
  const price = me?.is_admin ? 0 : video ? pricing.video : pricing.text;

  // Custom Style · Edit Footage Sendiri: script first, like Default — Default's own script step makes a "motion-edit"
  // card ("Semak skrip"); the VGC build starts when the client approves it (/api/motion/render → lib/motion-custom.ts)
  if (b?.script_first === true) {
    return startCustomScript({ userId: user.id, b, prompt, title, stepId, materials, price });
  }

  // the client's material is listed in the prompt so Claude Code knows what's in ./bahan/
  const bahanNote = materials.length
    ? `\n\nBAHAN YANG DIBERI (sudah ada dalam ./bahan/):\n${materials.map((m: { name: string }, i: number) => `- ${m.name || `bahan-${i + 1}`}`).join("\n")}`
    : "";
  const voiceNote = voice
    ? `

VOICE-OVER AI (izin klien diberi untuk suara ini): Klien memilih suara AI "${voice.label}" (Bahasa Melayu Malaysia). ` +
      `Jika langkah ini memerlukan voice-over, tulis skrip VO mengikut kaedah VGC, kemudian jana audio dengan arahan terminal:
` +
      `  pl-tts --out ./bahan/vo-01.mp3 "Ayat VO pertama."
` +
      `(satu fail bagi setiap ayat atau babak; arahan ini mencetak tempoh audio dalam saat; pilihan: --emotion happy|calm|surprised, --speed 0.9–1.2). ` +
      `Sync visual mengikut tempoh VO sebenar. Izin ini menggantikan larangan "guna TTS berbayar tanpa izin" untuk suara ini sahaja.`
    : "";
  const ttsToken = voice ? newPlanToken() : null;
  const current = { id: stepId, title, video, prompt: prompt.slice(0, 20_000) };

  // ── the next step of an existing project card, or a new card ──
  const cardId = typeof b?.card_id === "string" && /^[0-9a-f-]{36}$/i.test(b.card_id) ? b.card_id : null;
  let id: string;
  let prevMeta: Record<string, unknown> | null = null;
  let prevStatus = "";
  if (cardId) {
    const { data: row } = await admin.from("history").select("id, user_id, status, metadata").eq("id", cardId).maybeSingle();
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    if (!row || row.user_id !== user.id || meta.feature !== "motion-vgc") return NextResponse.json({ error: "Projek tidak dijumpai." }, { status: 404 });
    if (row.status !== "done" && row.status !== "failed") return NextResponse.json({ error: "Langkah sebelum ini masih berjalan." }, { status: 409 });
    id = row.id;
    prevMeta = meta;
    prevStatus = row.status;
  } else {
    const projectId = typeof b?.project_id === "string" && /^[0-9a-f-]{36}$/i.test(b.project_id) ? b.project_id : null;
    const vgc: VgcMeta = { flow, session_id: null, current, steps: [], spent: 0, ...(voice ? { tts: { voice: voice.key, token: ttsToken!, calls: 0 } } : {}) };
    const { data: hist, error } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: "video",
        tab: "motion",
        status: "pending",
        prompt: title || "Custom Style",
        task_id: null,
        cost: 0,
        metadata: { feature: "motion-vgc", model: "vgc", stage: "queued", reserved: price, vgc, input: { materials } },
      })
      .select("id")
      .single();
    if (error || !hist) return NextResponse.json({ error: error?.message || "Gagal cipta kad" }, { status: 500 });
    id = hist.id;
  }

  if (price > 0 && !(await reserveCredit(user.id, "motion", price, id))) {
    if (!cardId) await admin.from("history").delete().eq("id", id);
    return NextResponse.json({ error: `Kredit tidak mencukupi — perlu RM${price.toFixed(2)}.`, needed: price }, { status: 402 });
  }
  const refund = () => (price > 0 ? refundReserved(user.id, "motion", price, id) : Promise.resolve());

  if (cardId && prevMeta) {
    const pv = (prevMeta.vgc ?? {}) as VgcMeta;
    const known = new Set(((prevMeta.input as { materials?: { url: string }[] })?.materials ?? []).map((m) => m.url));
    const { data: flipped } = await admin
      .from("history")
      .update({
        status: "pending",
        error_message: null,
        task_id: null,
        metadata: {
          ...prevMeta,
          stage: "queued",
          reserved: price,
          step_started_at: new Date().toISOString(),
          vgc: { ...pv, current, tts: voice ? { voice: voice.key, token: ttsToken!, calls: 0 } : null },
          input: { materials: [...((prevMeta.input as { materials?: unknown[] })?.materials ?? []), ...materials.filter((m: { url: string }) => !known.has(m.url))] },
        },
      })
      .eq("id", id)
      .eq("status", prevStatus)
      .select("id");
    if (!flipped?.length) {
      await refund();
      return NextResponse.json({ error: "Projek sedang diproses." }, { status: 409 });
    }
  }

  const session = cardId ? ((prevMeta?.vgc as VgcMeta | undefined)?.session_id ?? null) : null;
  const stepNo = cardId ? (((prevMeta?.vgc as VgcMeta | undefined)?.steps?.length ?? 0) + 1) : 1;
  const start = await vgcStart({
    history_id: id,
    user_id: user.id,
    // a video run also gets PeningLab's master director (Default's latest playbook; the VGC style keeps the look)
    prompt: prompt + bahanNote + voiceNote + (video ? customDirectorPlaybook(/FOOTAGE/i.test(title) ? "footage" : "motion") : ""),
    materials,
    expect_video: video,
    ...(voice ? { tts: { url: `${siteUrl()}/api/vgc/tts`, token: ttsToken, voice: voice.key } } : {}),
    step: `s${stepNo}`,
    ...(session ? { session_id: session } : {}),
  });
  if (!start.ok) {
    await refund();
    if (cardId && prevMeta) await admin.from("history").update({ status: prevStatus, metadata: prevMeta }).eq("id", id);
    else await admin.from("history").update({ status: "failed", error_message: start.error, cost: 0 }).eq("id", id);
    return NextResponse.json({ error: `Gagal mula: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
  await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), provider: "modal-vgc" } }).eq("id", id);
  return NextResponse.json({ ok: true, id, video, price });
}

/** Step 1 of a Custom Style footage edit: Default's script step on a "motion-edit" card that carries the VGC prompt. */
async function startCustomScript(o: {
  userId: string; b: Record<string, unknown>; prompt: string; title: string; stepId: string;
  materials: { url: string; name: string }[]; price: number;
}) {
  const f = (o.b.footage ?? {}) as { url?: unknown; name?: unknown; dur?: unknown };
  const url = String(f.url ?? "");
  if (!MATERIAL_HOST.test(url)) return NextResponse.json({ error: "Tambah footage (video) di Bahan / Folder dulu." }, { status: 400 });
  const dur = Number(f.dur) || 0;
  if (!(dur > 0.5)) return NextResponse.json({ error: "Tak dapat baca tempoh footage — cuba upload semula." }, { status: 400 });
  const product = String(o.b.product ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || o.title.slice(0, 80) || "Custom Style";
  const others = o.materials.filter((m) => m.url !== url);
  const input: EditInput = {
    videoUrl: url,
    durationSec: Math.min(dur, MOTION_EDIT_MAX_SEC),
    language: "ms",
    product,
    productImages: others.filter((m) => /\.(jpe?g|png|webp)$/i.test(m.url)).map((m) => m.url).slice(0, 5),
    captions: true,
    captionStyle: "pop",
    captionPos: "low",
    music: false,
    sfx: true,
    style: "gempak",
    resolution: "1080",
    jumpcut: true,
    broll: false,
    facts: false,
    guard: true,
    auto: true,
    engine: "custom",
    custom: { prompt: o.prompt, title: o.title, stepId: o.stepId, materials: others },
  };
  const projectId = typeof o.b.project_id === "string" && /^[0-9a-f-]{36}$/i.test(o.b.project_id) ? o.b.project_id : null;
  const planToken = newPlanToken();
  const admin = createAdminClient();
  const { data: hist, error } = await admin
    .from("history")
    .insert({
      user_id: o.userId,
      project_id: projectId,
      type: "video",
      tab: "motion",
      status: "pending",
      prompt: o.title || product,
      reference_url: url,
      task_id: null,
      cost: o.price,
      duration: Math.round(input.durationSec),
      metadata: {
        feature: "motion-edit", model: "motion", stage: "queued", rate: 0, reserved: o.price,
        // the price of a Custom Style video: settled as the run's minimum (like the old Padat)
        ...(o.price > 0 ? { padat_min: o.price } : {}),
        input, plan_token: planToken, aspectRatio: "9:16", review: true,
      },
    })
    .select("id")
    .single();
  if (error || !hist) return NextResponse.json({ error: error?.message || "Gagal cipta kad" }, { status: 500 });
  if (o.price > 0 && !(await reserveCredit(o.userId, "motion", o.price, hist.id))) {
    await admin.from("history").delete().eq("id", hist.id);
    return NextResponse.json({ error: `Kredit tidak mencukupi — perlu RM${o.price.toFixed(2)}.`, needed: o.price }, { status: 402 });
  }
  const start = await motionStart({
    flow: "edit",
    phase: "draft",
    history_id: hist.id,
    user_id: o.userId,
    video_url: url,
    plan_url: `${siteUrl()}/api/motion/plan`,
    qa_url: `${siteUrl()}/api/motion/qa`,
    guard_url: `${siteUrl()}/api/motion/guard`,
    guard: true,
    plan_token: planToken,
    style: "gempak",
    look: "gempak",
    resolution: "1080",
    jumpcut: true,
    language: "ms",
    hint: product.slice(0, 120),
    music: false,
    sfx: true,
    max_sec: MOTION_EDIT_MAX_SEC,
    auto: true,
    captions: true,
  });
  if (!start.ok) {
    await admin.from("history").update({ status: "failed", error_message: start.error, cost: 0 }).eq("id", hist.id);
    if (o.price > 0) await refundReserved(o.userId, "motion", o.price, hist.id);
    return NextResponse.json({ error: `Gagal mula: ${start.error}` }, { status: 502 });
  }
  const { data: cur } = await admin.from("history").select("metadata").eq("id", hist.id).maybeSingle();
  await admin.from("history").update({ task_id: start.callId, metadata: { ...(cur?.metadata || {}), stage: "queued", provider: "modal-motion" } }).eq("id", hist.id);
  return NextResponse.json({ ok: true, id: hist.id, video: true, price: o.price, script: true });
}
