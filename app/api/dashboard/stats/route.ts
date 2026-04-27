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

  // Per-tab counts + cost, plus per-day-per-bucket rollup for the multi-line
  // chart (4 series: image / ugc / cinema / auto). Each bucket gets its own
  // daily count so the user can compare production trends head-to-head.
  let imageCount = 0;
  let ugcCount = 0;
  let cinemaCount = 0;
  let autoCount = 0;
  let cloneCount = 0;
  let totalCost = 0;
  // Map<dateKey, { image, ugc, cinema, auto, total }>
  const dailyMap = new Map<
    string,
    { image: number; ugc: number; cinema: number; auto: number; total: number }
  >();

  for (const r of rows || []) {
    const cost = Number(r.cost || 0);
    totalCost += cost;
    const tab = (r.tab as string) || "";
    let bucket: "image" | "ugc" | "cinema" | "auto" | null = null;
    if (tab === "image") {
      imageCount += 1;
      bucket = "image";
    } else if (tab === "video" || tab === "ugc") {
      ugcCount += 1;
      bucket = "ugc";
    } else if (tab === "cinema") {
      cinemaCount += 1;
      bucket = "cinema";
    } else if (tab === "auto") {
      autoCount += 1;
      bucket = "auto";
    } else if (tab === "clone") {
      cloneCount += 1;
    }

    const day = String(r.created_at).slice(0, 10);
    const cur =
      dailyMap.get(day) ||
      { image: 0, ugc: 0, cinema: 0, auto: 0, total: 0 };
    if (bucket) cur[bucket] += 1;
    cur.total += 1;
    dailyMap.set(day, cur);
  }

  // Build sorted daily array — fill empty days so the lines stay continuous.
  //
  // IMPORTANT: iterate using string-arithmetic (not Date math), because
  // `new Date("2026-04-27T00:00:00")` parses as LOCAL time. On a UTC+8 server
  // (or local dev in MY), `d.toISOString().slice(0, 10)` then yields the
  // PREVIOUS day, dropping today's rows from every series. Row binning above
  // uses raw `r.created_at.slice(0, 10)` (UTC), so we must match here.
  const daily: {
    date: string;
    count: number;
    image: number;
    ugc: number;
    cinema: number;
    auto: number;
  }[] = [];
  const addDays = (ymd: string, n: number): string => {
    const d = new Date(ymd + "T00:00:00Z"); // anchor as UTC
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let cursor = start;
  // Inclusive of end date — guard against runaway loops with a 366-day cap
  for (let i = 0; i < 366 && cursor <= end; i++) {
    const v =
      dailyMap.get(cursor) ||
      { image: 0, ugc: 0, cinema: 0, auto: 0, total: 0 };
    daily.push({
      date: cursor,
      count: v.total,
      image: v.image,
      ugc: v.ugc,
      cinema: v.cinema,
      auto: v.auto,
    });
    cursor = addDays(cursor, 1);
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
