import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/dashboard/stats?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Returns per-tab generation counts + total cost for the signed-in user across
// the given date range. Defaults: start = first of current month, end = today.
// Source: history table (status='done' rows only — pending/failed don't bill
// or count toward output). Cost matches credit_transactions because deduct
// only fires on settle-success, so summing history.cost where status='done'
// equals the same amount the user was charged.
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  // Default range — start of current month → today
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultEnd = today.toISOString().slice(0, 10);
  const start = startParam || defaultStart;
  const end = endParam || defaultEnd;

  const admin = createAdminClient();
  // Pull all done rows in range — small data, easy to aggregate JS-side
  const { data: rows } = await admin
    .from("history")
    .select("id, type, tab, cost, status, created_at")
    .eq("user_id", user.id)
    .gte("created_at", start + "T00:00:00")
    .lte("created_at", end + "T23:59:59")
    .eq("status", "done");

  // Per-tab counts + cost, plus per-day rollup for the trend chart
  let imageCount = 0;
  let ugcCount = 0;
  let cinemaCount = 0;
  let autoCount = 0;
  let cloneCount = 0;
  let totalCost = 0;
  const dailyMap = new Map<string, number>();

  for (const r of rows || []) {
    const cost = Number(r.cost || 0);
    totalCost += cost;
    const tab = (r.tab as string) || "";
    if (tab === "image") imageCount += 1;
    else if (tab === "video" || tab === "ugc") ugcCount += 1;
    else if (tab === "cinema") cinemaCount += 1;
    else if (tab === "auto") autoCount += 1;
    else if (tab === "clone") cloneCount += 1;

    const day = String(r.created_at).slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
  }

  // Build sorted daily array for the chart — fill empty days so the line is
  // continuous instead of skipping zero-output days.
  const daily: { date: string; count: number }[] = [];
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, count: dailyMap.get(key) || 0 });
  }

  return NextResponse.json({
    ok: true,
    start,
    end,
    counts: {
      image: imageCount,
      ugc: ugcCount,
      cinema: cinemaCount,
      auto: autoCount,
      clone: cloneCount,
      total:
        imageCount + ugcCount + cinemaCount + autoCount + cloneCount,
    },
    total_cost: Number(totalCost.toFixed(4)),
    daily,
  });
}
