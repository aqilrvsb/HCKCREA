import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { partnerGroupForManager } from "@/lib/partners";

// GET /api/partner/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
// Aggregate USAGE (credit spend) across ALL of a partner's clients — a
// partner-scoped version of the admin Usage view. Gated to a partner MANAGER
// (e.g. hqnl@gmail.com). Sums credit_transactions DEDUCTIONS (amount < 0) for
// every client tagged with the partner's managed_group, over the KL date range.
// Returns team totals + per-client + per-type (image/video/auto/other) rollups.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function categoryFor(reason: string): "image" | "video" | "auto" | "other" {
  if (reason === "image_generate") return "image";
  if (["video_8s", "video_16s", "cinema", "seedance", "grok", "template_body", "animate", "gpu_session"].includes(reason)) return "video";
  if (["auto_plan", "clone_plan"].includes(reason)) return "auto";
  return "other";
}

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const group = partnerGroupForManager(user.email);
  if (!group) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to perlu format YYYY-MM-DD" }, { status: 400 });
  }
  const startISO = `${from}T00:00:00+08:00`;
  const endISO = `${to}T23:59:59.999+08:00`;

  const admin = createAdminClient();

  // The partner's clients.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, credits, settings")
    .filter("settings->>managed_group", "eq", group)
    .limit(1000);
  const clients = (profiles || []).map((p: any) => ({
    id: p.id as string,
    name: (p.full_name as string) || "",
    email: (p.settings?.managed_email as string) || "",
    balance: Number(p.credits || 0),
  }));
  if (!clients.length) {
    return NextResponse.json({ ok: true, from, to, totals: { cost: 0, gens: 0 }, byType: {}, clients: [] });
  }
  const ids = clients.map((c) => c.id);

  const perClient = new Map<string, { cost: number; gens: number }>();
  clients.forEach((c) => perClient.set(c.id, { cost: 0, gens: 0 }));
  const byType: Record<string, { cost: number; gens: number }> = {
    image: { cost: 0, gens: 0 }, video: { cost: 0, gens: 0 }, auto: { cost: 0, gens: 0 }, other: { cost: 0, gens: 0 },
  };
  let totalCost = 0, totalGens = 0;

  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data: rows, error } = await admin
      .from("credit_transactions")
      .select("user_id, amount, reason, metadata")
      .in("user_id", ids)
      .lt("amount", 0) // deductions only (charges), skip top-ups/refunds
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = rows || [];
    for (const r of batch as any[]) {
      // A refund is stored as a POSITIVE amount, so amount<0 already excludes it.
      // Skip a reserve that was later released? The release is a separate +row,
      // so summing all negatives over the window nets correctly across pairs.
      const spend = -Number(r.amount || 0);
      if (!(spend > 0)) continue;
      totalCost += spend; totalGens += 1;
      const pc = perClient.get(r.user_id);
      if (pc) { pc.cost += spend; pc.gens += 1; }
      const cat = categoryFor(String(r.reason || ""));
      byType[cat].cost += spend; byType[cat].gens += 1;
    }
    if (batch.length < PAGE) break;
  }

  const clientRows = clients
    .map((c) => ({ ...c, ...(perClient.get(c.id) || { cost: 0, gens: 0 }) }))
    .sort((a, b) => b.cost - a.cost);

  return NextResponse.json({
    ok: true, from, to,
    totals: { cost: Number(totalCost.toFixed(2)), gens: totalGens, clients: clients.length },
    byType,
    clients: clientRows,
  });
}
