import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, reserveCredit } from "@/lib/deduct";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import {
  MOTION_AD_DURATIONS, MOTION_PLANNING_TASK, MOTION_VOICES, adEstimateSec, costFor, runAdJob, type AdInput,
} from "@/lib/motion";

// POST /api/motion/create — Motion "Buat Iklan": generate a motion-graphics ad
// from a product brief. Reserves the estimated cost, inserts a pending row,
// returns immediately; after() writes the script (model_motion), voices each
// line (MiniMax) and starts the Modal render. settleMotionRow finishes it.
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

  const b = await req.json().catch(() => ({} as any));
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
  const style = ["pop", "karaoke", "box"].includes(b?.caption_style) ? b.caption_style : "pop";

  const input: AdInput = {
    product,
    description,
    price: str(b?.price, 14) || undefined,
    oldPrice: str(b?.old_price, 14) || undefined,
    cta: str(b?.cta, 40) || undefined,
    handle: str(b?.handle, 40) || undefined,
    audience: str(b?.audience, 120) || undefined,
    vibe: str(b?.vibe, 80) || undefined,
    extra: str(b?.extra, 500) || undefined,
    language: b?.language === "en" ? "en" : "ms",
    seconds,
    voice: MOTION_VOICES.some((v) => v.key === voiceKey) ? voiceKey : "mira",
    speed: Math.max(0.85, Math.min(1.2, Number(b?.speed) || 1.0)),
    captions: b?.captions !== false,
    captionStyle: style,
    music: b?.music !== false,
    sfx: b?.sfx !== false,
    accent: /^#[0-9a-f]{6}$/i.test(String(b?.accent || "")) ? String(b.accent) : undefined,
    images: images as AdInput["images"],
  };
  const projectId = b?.project_id ? String(b.project_id) : null;

  const rate = await priceFor(user.id, "motion", "motion");
  const estimate = costFor(adEstimateSec(seconds), rate);

  const admin = createAdminClient();
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
        input,
        aspectRatio: "9:16",
      },
    })
    .select("id")
    .single();
  if (insErr || !hist) {
    return NextResponse.json({ error: "DB insert failed", detail: insErr?.message }, { status: 500 });
  }

  const ok = await reserveCredit(user.id, "motion", estimate, hist.id);
  if (!ok) {
    await admin.from("history").delete().eq("id", hist.id);
    return NextResponse.json(
      { error: `Kredit tidak mencukupi — perlu RM${estimate.toFixed(2)} untuk iklan ${seconds}s.`, needed: estimate },
      { status: 402 }
    );
  }

  after(() => runAdJob(hist.id));

  return NextResponse.json({ ok: true, id: hist.id, estimate, rate });
}
