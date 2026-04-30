import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  scrapeAffiliateUrl,
  cacheTikTokProduct,
  recordUserHistory,
} from "@/lib/scraper";
import { getRunningHubConfig } from "@/lib/settings";

export const runtime = "nodejs";
// Up to 5 TikHub retries with backoff = ~15s, plus RH upload ~5s, plus
// cache write — give ourselves headroom over the previous 90s budget.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// POST /api/scrape/affiliate { url }
//
// Pulls product details from a TikTok Shop / Shopee / Lazada / generic
// affiliate URL via Crawlbase, then re-uploads the scraped product image
// to RunningHub so the auto-content pipeline gets a public URL Crun /
// GeminiGen can fetch from. Returns a normalised payload that the Auto
// Content tab consumes to pre-fill manual_products[0].
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const scraped = await scrapeAffiliateUrl(url);
  if (!scraped.ok) {
    return NextResponse.json(
      {
        error: scraped.error || "Scrape returned no product data",
        source: scraped.source,
      },
      { status: 502 }
    );
  }

  // Cache hit short-circuit — scrapeAffiliateUrl already returned the
  // RH-hosted image URL stored on the cache row. Skip the re-upload step
  // entirely (saves 3-5s of latency + bandwidth on every viral product).
  // Still bump the user's history so the dropdown stays current.
  let hostedImageUrl = scraped.product_image_url;
  const isCacheHit = scraped.source === "cache";

  if (!isCacheHit && hostedImageUrl) {
    // Fresh scrape — re-host the scraped product image on RunningHub so
    // Crun.ai / GeminiGen can fetch it reliably (TikTok / Shopee CDN URLs
    // sometimes block hot-link requests from Crun's region).
    try {
      const rhCfg = await getRunningHubConfig();
      if (rhCfg.key && rhCfg.uploadUrl) {
        const imgRes = await fetch(hostedImageUrl, {
          signal: AbortSignal.timeout(20_000),
        });
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          const fd = new FormData();
          fd.append("file", blob, "scraped.jpg");
          const upRes = await fetch(rhCfg.uploadUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${rhCfg.key}` },
            body: fd,
          });
          const upJson: any = await upRes.json().catch(() => null);
          const rhUrl =
            upJson?.data?.download_url ||
            upJson?.data?.url ||
            upJson?.data?.fileUrl ||
            null;
          if (upRes.ok && rhUrl) hostedImageUrl = rhUrl;
        }
      }
    } catch {
      // Best-effort — fall back to the original CDN URL if RunningHub
      // upload fails. Auto Content will still try to use it.
    }
  }

  // Persist to cache + user history. On cache hits we only need to
  // bump the user's history (the cache row itself was already touched
  // by scrapeAffiliateUrl). On fresh scrapes we upsert the full row
  // including the just-rehosted image URL.
  if (isCacheHit) {
    if (scraped.product_id) {
      recordUserHistory(user.id, scraped.product_id).catch(() => {});
    }
  } else {
    cacheTikTokProduct(scraped, hostedImageUrl, user.id).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    source: scraped.source,
    product_name: scraped.product_name,
    // ORIGINAL TikTok CDN URL — used by frontend for thumbnail display
    // (permanent, doesn't expire). Frontend renders with
    // referrerPolicy="no-referrer" to bypass TikTok's hot-link block.
    product_image_url: scraped.product_image_url || hostedImageUrl,
    // RH-rehosted URL — used for AI generation pipelines. Expires after
    // 24h; backend regenerates it on next fetch when stale.
    hosted_image_url: hostedImageUrl,
    description: scraped.description,
    price: scraped.price || null,
    rating: scraped.rating || null,
    total_sold: scraped.total_sold || null,
    category: scraped.category || null,
    // TikTok product_id (when known) so the auto-content fan-out can
    // stamp it on every history row's metadata for later auto-post.
    product_id: scraped.product_id || null,
  });
}
