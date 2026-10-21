import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { motionCheck } from "@/lib/motion";
import { CLIPPER_JOB_TAB, CLIPPER_TAB, settleClipperJob } from "@/lib/clipper";

// GET /api/clipper/jobs?project_id= — the client's CLIPPER analyses (newest first). Pending ones are checked on
// Modal and settled right here, so the list updates within seconds of the director finishing.
// DELETE /api/clipper/jobs?id= — remove one analysis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COLS = "id, user_id, status, task_id, created_at, error_message, prompt, thumbnail_url, duration, project_id, metadata";

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  const admin = createAdminClient();
  let q = admin.from("history").select(COLS).eq("user_id", user.id).eq("tab", CLIPPER_JOB_TAB).order("created_at", { ascending: false }).limit(20);
  if (projectId && /^[0-9a-f-]{36}$/i.test(projectId)) q = q.eq("project_id", projectId);
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const progress: Record<string, { stage?: string; pct?: number } | null> = {};
  const pending = (rows ?? []).filter((r: any) => r.status === "pending");
  if (pending.length) {
    await Promise.all(pending.map(async (r: any) => {
      const c = r.task_id ? await motionCheck(r.task_id).catch(() => null) : null;
      const s = await settleClipperJob(r, c ?? undefined).catch(() => null);
      progress[r.id] = s?.progress ?? (c && c.status === "running" ? c.progress ?? null : null);
    }));
  }
  const fresh = pending.length
    ? (await admin.from("history").select(COLS).in("id", (rows ?? []).map((r: any) => r.id)).order("created_at", { ascending: false })).data ?? rows
    : rows;
  // each analysis's rendered clips (History rows on the clipper tab): status chips + the ZIP
  const jobIds = (fresh ?? []).filter((r: any) => r.status === "done").map((r: any) => r.id);
  const renders: Record<string, { id: string; status: string; url: string | null; title: string; start: number | null }[]> = {};
  if (jobIds.length) {
    const { data: rr } = await admin.from("history").select("id, status, output_url, prompt, metadata->clipper")
      .eq("user_id", user.id).eq("tab", CLIPPER_TAB).in("metadata->clipper->>job_id", jobIds).order("created_at", { ascending: true }).limit(400);
    for (const r of (rr ?? []) as any[]) {
      const j = r.clipper?.job_id;
      if (!j) continue;
      (renders[j] ??= []).push({ id: r.id, status: r.status, url: r.output_url ?? null, title: r.prompt || "Klip", start: r.clipper?.start ?? null });
    }
  }
  return NextResponse.json({
    jobs: (fresh ?? []).map((r: any) => ({
      renders: renders[r.id] ?? [],
      id: r.id,
      status: r.status,
      stage: progress[r.id]?.stage ?? r.metadata?.stage ?? null,
      pct: progress[r.id]?.pct ?? null,
      error: r.error_message,
      created_at: r.created_at,
      source: r.metadata?.source ?? null,
      options: r.metadata?.options ?? null,
      analysis: r.metadata?.analysis ?? null,
    })),
  });
}

export async function DELETE(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await createAdminClient().from("history").delete().eq("id", id).eq("user_id", user.id).eq("tab", CLIPPER_JOB_TAB);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
