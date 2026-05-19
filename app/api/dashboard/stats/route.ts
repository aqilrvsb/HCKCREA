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
    .select("id, type, tab, cost, status, created_at, metadata")
    .eq("user_id", user.id)
    .gte("created_at", start + "T00:00:00")
    .lte("created_at", end + "T23:59:59")
    .eq("status", "done");

  // Per-tab counts + cost. Buckets expanded to include Sora 2, Talking
  // Object (Viral), and Storytelling (final merged video only — excludes
  // per-scene fairytale-scene + fairytale-hero auxiliary images).
  // Cinema bucket KEPT in the API for back-compat but no longer surfaced
  // as a stat card in the dashboard overview.
  let imageCount = 0;
  let ugcCount = 0;
  let cinemaCount = 0;
  let autoCount = 0;
  let cloneCount = 0;
  let sora2Count = 0;
  let talkingObjectCount = 0;
  let storyCount = 0;
  let totalCost = 0;
  const dailyMap = new Map<
    string,
    { image: number; ugc: number; cinema: number; auto: number; total: number }
  >();

  for (const r of rows || []) {
    const cost = Number(r.cost || 0);
    totalCost += cost;
    const tab = (r.tab as string) || "";
    const type = (r.type as string) || "";
    const meta = ((r.metadata as any) || {}) as Record<string, any>;
    const featureType = String(meta.featureType || "").toLowerCase();
    const modelChoice = String(meta.modelChoice || "").toLowerCase();

    let bucket: "image" | "ugc" | "cinema" | "auto" | null = null;
    // Sora 2 — detected by tab OR modelChoice (Auto Content Sora 2 rows
    // still have tab='auto' but metadata.modelChoice='sora2').
    if (tab === "sora2" || modelChoice === "sora2") {
      sora2Count += 1;
    } else if (tab === "cinema" && featureType === "talking-object") {
      // Viral Talking Object video (skip the source-image auxiliary row).
      talkingObjectCount += 1;
      bucket = "cinema";
    } else if (tab === "fairytale" && type === "fairytale") {
      // Storytelling final merged video only — scene/hero images excluded.
      storyCount += 1;
    } else if (tab === "image") {
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
      sora2: sora2Count,
      talking_object: talkingObjectCount,
      story: storyCount,
      total:
        imageCount + ugcCount + cinemaCount + autoCount + cloneCount +
        sora2Count + talkingObjectCount + storyCount,
    },
    total_cost: Number(totalCost.toFixed(4)),
    daily,
  });
}
