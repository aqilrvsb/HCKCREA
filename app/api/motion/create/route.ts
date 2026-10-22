import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, reserveCredit } from "@/lib/deduct";
import { hiddenModesForUser, isTabAllowedForUser } from "@/lib/partner-tab-gate";
import {
  MOTION_AD_DURATIONS, MOTION_PLANNING_TASK, MOTION_VOICES, adEstimateSec, allowedEngine, costFor, motionAdEnabled, newPlanToken, round2, runAdJob,
  type AdInput,
} from "@/lib/motion";
import { isMotionStyle } from "@/lib/motion-styles";
import { padatMin, startPadatAdRow } from "@/lib/motion-padat";
import { vgcStyle } from "@/lib/vgc-styles";

// POST /api/motion/create — Motion "Buat Iklan": generate a motion-graphics ad
// from a product brief. Reserves the estimated cost, inserts a pending row,
// returns immediately; after() writes the script (model_motion), voices each
// line (MiniMax) and starts the Modal render. settleMotionRow finishes it.
// Engine "padat": Claude Code writes, voices (pl-tts) and builds the whole ad
// on HyperFrames instead (lib/motion-padat.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  // admins keep Buat Iklan while it is closed to clients (to test / sign it off)
  const { data: prof } = await createAdminClient().from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  const isAdmin = !!prof?.is_admin;
  const b = await req.json().catch(() => ({} as any));
  // Motion → Custom without a video ("Story Description"): the same image-to-video engine, part of Custom — not
  // behind the Buat Iklan switches
  const customStory = b?.custom_story === true;
  if (!customStory) {
    if (!(await motionAdEnabled()) && !isAdmin) {
      return NextResponse.json({ error: "Buat Iklan belum dibuka buat masa ini." }, { status: 403 });
    }
    if ((await hiddenModesForUser(user.id)).includes("motion-ad")) {
      return NextResponse.json({ error: "Buat Iklan tidak tersedia untuk akaun anda." }, { status: 403 });
    }
  }

  const product = str(b?.product, 80);
  const description = String(b?.description ?? "").trim().slice(0, 1500);
  if (!product) return NextResponse.json({ error: "Nama produk diperlukan." }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: "Terangkan produk sekurang-kurangnya satu ayat." }, { status: 400 });

  const seconds = (MOTION_AD_DURATIONS as readonly number[]).includes(Number(b?.seconds)) ? Number(b.seconds) : 30;
  const voiceKey = String(b?.voice || "mira").toLowerCase();
  const images = (Array.isArray(b?.images) ? b.images : [])
    .filter((im: any) => typeof im?.url === "string" && /^https:\/\//.test(im.url))
    .slice(0, 4)
    .map((im: any) => ({ url: String(im.url), role: im.role === "presenter" ? "presenter" : "product" }));
  const style = ["pop", "karaoke", "box", "tiktok"].includes(b?.caption_style) ? b.caption_style : "pop";
  let vgc: Awaited<ReturnType<typeof vgcStyle>> = null;
  if (customStory) {
    vgc = await vgcStyle(String(b?.vgc_style || ""));
    if (!vgc) return NextResponse.json({ error: "Pilih satu style dulu." }, { status: 400 });
    if (description.length < 20) return NextResponse.json({ error: "Story Description terlalu pendek — ceritakan sekurang-kurangnya satu dua ayat." }, { status: 400 });
    if (!images.length) return NextResponse.json({ error: "Upload sekurang-kurangnya 1 gambar." }, { status: 400 });
  }
  const styleAccent = vgc?.colors?.[2] && /^#[0-9a-f]{6}$/i.test(vgc.colors[2]) ? vgc.colors[2] : undefined;

  const input: AdInput = {
    product,
    description,
    price: str(b?.price, 14) || undefined,
    oldPrice: str(b?.old_price, 14) || undefined,
    cta: str(b?.cta, 40) || undefined,
    handle: str(b?.handle, 40) || undefined,
    audience: str(b?.audience, 120) || undefined,
    vibe: str(b?.vibe, 80) || undefined,
    extra: str(b?.prompt ?? b?.extra, 900) || undefined,
    language: b?.language === "en" ? "en" : "ms",
    seconds,
    voice: MOTION_VOICES.some((v) => v.key === voiceKey) ? voiceKey : "mira",
    speed: Math.max(0.85, Math.min(1.2, Number(b?.speed) || 1.0)),
    captions: b?.captions !== false,
    captionStyle: style,
    music: b?.music !== false,
    sfx: b?.sfx !== false,
    accent: /^#[0-9a-f]{6}$/i.test(String(b?.accent || "")) ? String(b.accent) : styleAccent,
    images: images as AdInput["images"],
    style: isMotionStyle(b?.style) ? b.style : "gempak",
    resolution: b?.resolution === "720" ? "720" : "1080",
    guard: b?.guard === true,
    engine: await allowedEngine(b?.engine, user.id),
    ...(customStory ? { story: true } : {}),
    ...(vgc ? { vgcStyle: { id: vgc.id, name: vgc.name, brief: vgc.brief.slice(0, 3000), ...(vgc.colors?.length ? { colors: vgc.colors.slice(0, 3) } : {}) } } : {}),
  };
  const padat = input.engine === "padat";
  // admins may pin the renderer of a test ad (HyperFrames sign-off); clients always follow the switch
  const pinRenderer: "hyperframes" | "remotion" | null = isAdmin && (b?.renderer === "hyperframes" || b?.renderer === "remotion") ? b.renderer : null;
  const variations = Math.max(1, Math.min(3, Math.round(Number(b?.variations) || 1)));
  const projectId = b?.project_id ? String(b.project_id) : null;

  const rate = await priceFor(user.id, "motion", "motion");
  const minCost = padat ? await padatMin(rate) : 0;
  const estimate = round2(Math.max(costFor(adEstimateSec(seconds), rate), minCost));

  const admin = createAdminClient();
  const ids: string[] = [];
  let stopError: string | null = null;
  for (let v = 0; v < variations; v++) {
    const vInput: AdInput = variations > 1 ? { ...input, variant: { index: v, total: variations } } : input;
    const { data: hist, error: insErr } = await admin
      .from("history")
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: "video",
        tab: "motion",
        status: "pending",
        prompt: `${product} — ${description}`.slice(0, 2000),
        reference_url: images[0]?.url || null,
        task_id: MOTION_PLANNING_TASK,
        cost: estimate,
        duration: seconds,
        metadata: {
          feature: "motion-ad",
          model: "motion",
          stage: "queued",
          rate,
          reserved: estimate,
          input: vInput,
          // Modal calls /api/motion/guard with it (product-photo OCR) when the guard is on.
          plan_token: newPlanToken(),
          aspectRatio: "9:16",
          ...(variations > 1 ? { variation: `${v + 1}/${variations}` } : {}),
          ...(pinRenderer ? { renderer: pinRenderer } : {}),
          // Padat: the run's own token for the AI voice (/api/vgc/tts)
          ...(padat ? { padat_min: minCost, padat: { tts: { voice: input.voice, token: newPlanToken(), calls: 0 } } } : {}),
        },
      })
      .select("id")
      .single();
    if (insErr || !hist) { stopError = insErr?.message || "DB insert failed"; break; }
    const ok = await reserveCredit(user.id, "motion", estimate, hist.id);
    if (!ok) {
      await admin.from("history").delete().eq("id", hist.id);
      stopError = `Kredit tidak mencukupi — perlu RM${estimate.toFixed(2)} setiap iklan ${seconds}s.`;
      break;
    }
    ids.push(hist.id);
  }
  if (!ids.length) {
    return NextResponse.json({ error: stopError || "Gagal mula", needed: estimate }, { status: stopError?.startsWith("Kredit") ? 402 : 500 });
  }

  // Each variation writes its own script + voice in parallel, in the background
  // (Padat: each starts its own Claude Code run at once — all in parallel).
  after(() => Promise.all(ids.map((id) => (padat ? startPadatAdRow(id) : runAdJob(id)))).then(() => undefined));

  return NextResponse.json({ ok: true, id: ids[0], ids, estimate, rate, ...(stopError ? { warning: stopError } : {}) });
}
