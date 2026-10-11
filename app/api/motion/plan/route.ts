import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planEdit, tokenMatches, type EditInput } from "@/lib/motion";

// POST /api/motion/plan — called BY the Modal Edit Video job once it has the
// transcript. Auth = the per-row plan_token minted at submit (only Modal has
// it). Runs the model_motion LLM cascade here, so admin's provider + fallback
// settings apply, and returns the caption/overlay plan for the render.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  try {
    const plan = await planEdit({ words, duration, input: row.metadata?.input as EditInput });
    const { data: cur } = await admin.from("history").select("metadata").eq("id", id).maybeSingle();
    await admin
      .from("history")
      .update({
        metadata: {
          ...(cur?.metadata || {}),
          stage: "render",
          plan: { hook: plan.hook, overlays: plan.overlays.length, zooms: plan.zooms.length, words: words.length },
          transcript: words.map((w: any) => w.w).join(" ").slice(0, 4000),
        },
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, plan });
  } catch (e: any) {
    // Modal falls back to captions-only when the plan fails.
    return NextResponse.json({ ok: false, error: e?.message || "plan failed" }, { status: 502 });
  }
}
