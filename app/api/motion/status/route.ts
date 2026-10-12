import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOTION_PLANNING_TASK, motionCheck, settleMotionRow } from "@/lib/motion";
import { motionGuardSummary } from "@/lib/motion-guard-summary";

// GET /api/motion/status?ids=a,b,c — live state of the caller's Motion jobs.
// Pending rows are checked against Modal; finished ones are settled right here
// (same settleMotionRow the poll-pending cron uses), so the tab updates within
// seconds of the render finishing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (ids.length === 0) return NextResponse.json({ jobs: [] });

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, type, tab, status, task_id, duration, cost, metadata, error_message, output_url, created_at")
    .in("id", ids)
    .eq("user_id", user.id)
    .eq("tab", "motion");

  const jobs = await Promise.all((rows || []).map(async (row: any) => {
    let progress: { stage?: string; pct?: number } | null = null;
    let cur = row;
    if (row.status === "pending") {
      if (row.task_id && !String(row.task_id).startsWith(MOTION_PLANNING_TASK)) {
        const c = await motionCheck(row.task_id);
        if (c.status === "running") progress = c.progress ?? null;
        if (c.status === "done" || c.status === "failed") {
          await settleMotionRow(row, c);
          const { data } = await admin.from("history").select("id, status, cost, duration, metadata, error_message, output_url").eq("id", row.id).maybeSingle();
          if (data) cur = { ...row, ...data };
        }
      } else {
        await settleMotionRow(row); // expires a lost planning step
        const { data } = await admin.from("history").select("id, status, cost, metadata, error_message").eq("id", row.id).maybeSingle();
        if (data) cur = { ...row, ...data };
        progress = { stage: String(cur.metadata?.stage || "script"), pct: 0 };
      }
    }
    return {
      id: cur.id,
      status: cur.status,
      feature: cur.metadata?.feature,
      stage: progress?.stage || cur.metadata?.stage || null,
      pct: progress?.pct ?? null,
      output_url: cur.output_url || null,
      poster_url: cur.metadata?.poster_url || null,
      cost: Number(cur.cost) || 0,
      error: cur.error_message || null,
      script: cur.metadata?.plan?.lines || null,
      guard: motionGuardSummary(cur.metadata?.guard),
    };
  }));
  return NextResponse.json({ jobs });
}
