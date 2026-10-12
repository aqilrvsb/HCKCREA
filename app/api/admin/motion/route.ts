import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { malaysiaDayToUtcRange } from "@/lib/date-util";
import { motionGuardSummary } from "@/lib/motion-guard-summary";

// GET /api/admin/motion?start=YYYY-MM-DD&end=YYYY-MM-DD — admin Motion
// monitor: every Motion job (all clients) in the Malaysia-day range, running /
// done / failed, with what the pipeline did (plan, guard, render). Unlike
// /api/admin/usage (credit deductions only) this also shows running and
// failed jobs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const admin = createAdminClient();

  const PAGE = 1000;
  const hist: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from("history")
      .select("id, user_id, status, cost, duration, created_at, updated_at, output_url, error_message, metadata")
      .eq("tab", "motion")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (start) q = q.gte("created_at", malaysiaDayToUtcRange(start, "start"));
    if (end) q = q.lte("created_at", malaysiaDayToUtcRange(end, "end"));
    const { data, error } = await q;
    if (error || !data?.length) break;
    hist.push(...data);
    if (data.length < PAGE) break;
  }

  const emailById = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    users.forEach((u) => emailById.set(u.id, u.email || ""));
    if (users.length < 1000) break;
  }

  const num = (v: unknown) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const obj = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const rows = hist.map((h) => {
    const m = obj(h.metadata) ?? {};
    const input = obj(m.input) ?? {};
    const plan = obj(m.plan);
    const render = obj(m.render);
    const ad = m.feature === "motion-ad";
    return {
      id: h.id,
      email: emailById.get(String(h.user_id)) || "—",
      created_at: h.created_at,
      updated_at: h.updated_at,
      status: h.status,
      stage: str(m.stage),
      error: str(h.error_message),
      mode: ad ? "ad" : "edit",
      cost: num(h.cost),
      reserved: num(m.reserved),
      duration: num(render?.duration_sec) ?? num(h.duration) ?? num(input.durationSec),
      style: str(input.style),
      language: str(input.language),
      guardOn: !!input.guard,
      uploads: Array.isArray(input.productImages) ? input.productImages.length : 0,
      product: ad ? str(input.product) : null,
      plan: plan
        ? {
          sec: num(plan.ms) !== null ? Math.round(Number(plan.ms) / 1000) : null,
          overlays: num(plan.overlays) ?? (Array.isArray(plan.scenes) ? plan.scenes.length : null),
          broll: num(plan.broll),
          zooms: num(plan.zooms),
          fixes: Array.isArray(plan.caption_fixes) ? plan.caption_fixes.length : null,
          brand: str(plan.brand),
        }
        : null,
      fallback: !!render?.plan_fallback,
      renderSec: num(render?.render_sec),
      guard: motionGuardSummary(m.guard),
      output: str(h.output_url),
      poster: str(m.poster_url),
    };
  });

  return NextResponse.json({ rows });
}
