import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches } from "@/lib/motion";
import { qaPatch } from "@/lib/motion-director";

// POST /api/motion/qa — called BY the Modal Edit Video job with ≤6 rendered
// stills of the planned edit. A vision model (model_motion cascade) reviews
// them like a human editor would and returns a small patch (drop / move
// overlays, drop / shrink B-roll). Auth = the row's plan_token.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.history_id || "");
  const token = String(b?.token || "");
  if (!id || !token) return NextResponse.json({ ok: false, error: "history_id + token required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, tab, status, metadata").eq("id", id).maybeSingle();
  // CLIPPER clips run the same render (headlines, B-roll, stickers) — their QA stills were rendered and then refused
  if (!row || (row.tab !== "motion" && row.tab !== "clipper") || !tokenMatches(token, row.metadata?.plan_token)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") return NextResponse.json({ ok: false, error: "row not pending" }, { status: 409 });

  const stills = (Array.isArray(b?.stills) ? b.stills : [])
    .filter((s: any) => typeof s?.image === "string" && s.image.startsWith("data:image/") && s.image.length < 1_500_000)
    .slice(0, 6)
    .map((s: any) => ({ frame: Number(s.frame) || 0, t: Number(s.t) || 0, active: Array.isArray(s.active) ? s.active.map(String).slice(0, 8) : [], image: s.image,
      eyes: Array.isArray(s.eyes) && s.eyes.length === 2 && s.eyes.every((v: unknown) => typeof v === "number" && v >= 0 && v <= 1)
        ? [Number(s.eyes[0]), Number(s.eyes[1])] as [number, number] : null }));
  try {
    const patch = await qaPatch({
      stills,
      overlays: Array.isArray(b?.overlays) ? b.overlays.slice(0, 80) : [],
      broll: Array.isArray(b?.broll) ? b.broll.slice(0, 20) : [],
    });
    if (!patch) return NextResponse.json({ ok: false, error: "qa unavailable" }, { status: 502 });
    const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
    await admin.from("history").update({ metadata: { ...(cur?.metadata || {}), stage: "render", qa: patch } }).eq("id", id);
    return NextResponse.json({ ok: true, patch });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "qa failed" }, { status: 502 });
  }
}
