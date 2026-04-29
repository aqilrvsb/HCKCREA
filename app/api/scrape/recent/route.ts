import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecentProductsForUser } from "@/lib/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/scrape/recent
//
// Returns the caller's last 20 fetched TikTok products for the Auto
// Content tab's "Your recent products" dropdown. Joins
// user_product_history → tiktok_product_cache so we get product
// thumbnails + price alongside the URL. Click → /api/scrape/affiliate
// will then hit the cache and respond instantly.
export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await getRecentProductsForUser(user.id, 20);
  return NextResponse.json({ ok: true, items });
}
