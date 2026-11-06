import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { motionStop } from "@/lib/motion";
import { CLIPPER_JOB_TAB } from "@/lib/clipper";

// POST /api/clipper/live-stop { id } — CLIPPER, a TikTok LIVE being recorded: stop the recording now; the clips are
// made from what's recorded so far (the analysis carries on by itself).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("history").select("id, status, task_id, metadata")
    .eq("id", id).eq("user_id", user.id).eq("tab", CLIPPER_JOB_TAB).maybeSingle();
  if (!row) return NextResponse.json({ error: "Analisa tidak dijumpai." }, { status: 404 });
  if (row.status !== "pending" || row.metadata?.source?.type !== "tiktoklive" || !row.task_id) {
    return NextResponse.json({ error: "Rakaman ini sudah tamat." }, { status: 409 });
  }
  const r = await motionStop(row.task_id);
  if (!r.ok) return NextResponse.json({ error: `Gagal hentikan rakaman: ${r.error}` }, { status: 502 });
  await admin.from("history").update({ metadata: { ...row.metadata, live: { ...(row.metadata?.live || {}), stop_at: new Date().toISOString() } } })
    .eq("id", id).eq("status", "pending");
  return NextResponse.json({ ok: true });
}
